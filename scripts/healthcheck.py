#!/usr/bin/env python3
"""漫画源健康检查。

对 scripts/checks.json 中的每个源发起 HTTP 探测并分类:
  ok          正常
  dead        连接失败 / DNS 解析失败
  parked      域名被售卖(跳转到域名交易页)
  cloudflare  Cloudflare 人机验证页
  blocked     403/401 等拒绝(可能是地域限制, 不一定是源失效)
  unexpected  其他异常状态码

CI 模式(--ci)下自动管理 issue:
  - dead/parked/cloudflare 的源若无 open issue 则创建 [source-down] <key>
  - 恢复的源自动评论并关闭对应 issue

用法:
  python scripts/healthcheck.py                     # 全量检查, 仅打印
  python scripts/healthcheck.py --only a,b          # 只检查指定 key
  python scripts/healthcheck.py --ci                # CI 模式(需要 gh + GH_TOKEN)
"""
import argparse
import concurrent.futures
import datetime
import json
import os
import re
import subprocess
import sys
import ssl
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CHECKS_FILE = os.path.join(HERE, "checks.json")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)

PARK_HOSTS = (
    "globalstore.example.net",
    "sedoparking.com",
    "afternic.com",
    "hugedomains.com",
    "dan.com",
    "bodis.com",
)
PARK_BODY = re.compile(
    r"domain (?:is )?(?:for sale|may be for sale)|buy this domain|"
    r"this domain is available|域名出售|域名交易|sedo parking",
    re.I,
)
PARK_HOST_RE = re.compile(r"^(?:ww\d+\.|www\d+\.)", re.I)
CF_BODY = re.compile(r"just a moment|cf-chl|challenge-platform|__cf_chl", re.I)

# 这些状态的源才会开 issue; blocked/unexpected 通常只是地域或机器人拦截
ISSUE_STATES = {"dead", "parked", "cloudflare"}


def fetch(url, timeout=20):
    """返回 (status, final_url, body_head, error)."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # 可用性探测不校验证书, 避免本地证书链误报
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            body = resp.read(8192).decode("utf-8", "replace")
            return resp.status, resp.geturl(), body, None
    except urllib.error.HTTPError as e:
        try:
            body = e.read(8192).decode("utf-8", "replace")
        except Exception:
            body = ""
        return e.code, url, body, None
    except Exception as e:
        return None, url, "", f"{type(e).__name__}: {e}"


def netloc(url):
    return re.sub(r"^https?://", "", url).split("/", 1)[0].split(":", 1)[0].lower()


def classify(entry, result):
    status, final_url, body, err = result
    expect = entry.get("expect", [200])
    if err is not None:
        return "dead", f"连接失败 {err}"
    # 停放检测必须在 expect 判定之前: 域名交易页通常返回 200
    host = netloc(final_url)
    host_changed = netloc(entry["url"]) != host
    if (host_changed and (any(p in host for p in PARK_HOSTS) or PARK_HOST_RE.match(host))) \
            or (host_changed and PARK_BODY.search(body)):
        return "parked", f"域名跳转至 {final_url} (疑似已售卖)"
    if status in expect:
        return "ok", f"HTTP {status}"
    if CF_BODY.search(body):
        return "cloudflare", f"HTTP {status} Cloudflare 人机验证"
    if status in (401, 403):
        return "blocked", f"HTTP {status} (可能是地域/反爬限制)"
    return "unexpected", f"HTTP {status}"


def check_source(key, cfg):
    urls = cfg.get("urls", [])
    require = cfg.get("require", "all")
    details, ok_count, worst = [], 0, ("ok", "")
    rank = {"ok": 0, "unexpected": 1, "blocked": 2, "cloudflare": 3, "parked": 4, "dead": 5}
    for entry in urls:
        res = fetch(entry["url"])
        state, msg = classify(entry, res)
        soft = entry.get("soft", False)
        if state == "ok":
            ok_count += 1
        elif soft and state != "dead":
            state, msg = "ok", f"(soft) {msg}"
        if rank[state] > rank[worst[0]]:
            worst = (state, msg)
        details.append(f"{entry['url']} -> {msg}")
    passed = ok_count == len(urls) if require == "all" else ok_count > 0
    state = "ok" if passed else worst[0]
    return {
        "key": key,
        "name": cfg.get("name", key),
        "state": state,
        "declared": cfg.get("status"),
        "note": cfg.get("note", ""),
        "details": details,
    }


def run_checks(only=None):
    checks = json.load(open(CHECKS_FILE, encoding="utf-8"))
    keys = [k for k in checks if k != "comment" and (not only or k in only)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(check_source, k, checks[k]): k for k in keys}
        results = [f.result() for f in concurrent.futures.as_completed(futures)]
    results.sort(key=lambda r: (r["state"] != "ok", r["key"]))
    return results


def gh(args, check=True):
    cmd = ["gh"] + args
    p = subprocess.run(cmd, capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)}\n{p.stderr.strip()}")
    return p.stdout.strip()


def manage_issues(results, run_url=""):
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    try:
        gh(["label", "create", "source-down", "--color", "d73a4a",
            "--description", "漫画源健康检查发现异常"], check=False)
    except Exception:
        pass

    listed = json.loads(gh(["issue", "list", "--label", "source-down",
                            "--state", "open", "--json", "number,title",
                            "--limit", "200"]) or "[]")
    open_map = {}
    for it in listed:
        m = re.match(r"\[source-down\]\s*(\S+)", it["title"])
        if m:
            open_map[m.group(1)] = it["number"]

    for r in results:
        title = f"[source-down] {r['key']} ({r['name']})"
        body = (
            f"**源**: {r['name']} (`{r['key']}`)\n"
            f"**状态**: {r['state']}\n"
            + (f"**备注**: {r['note']}\n" if r["note"] else "")
            + (f"**已知状态**: {r['declared']}\n" if r["declared"] else "")
            + "\n**探测详情**:\n"
            + "\n".join(f"- {d}" for d in r["details"])
            + f"\n\n检查时间: {now}" + (f"\n运行链接: {run_url}" if run_url else "")
        )
        # declared 字段表示"已知此源处于失效状态", 不再重复开 issue
        if r["state"] in ISSUE_STATES and not r["declared"]:
            if r["key"] not in open_map:
                gh(["issue", "create", "--title", title, "--body", body,
                    "--label", "source-down"])
                print(f"[issue] created: {title}")
        elif r["state"] == "ok" and r["key"] in open_map:
            gh(["issue", "close", str(open_map[r["key"]]),
                "--comment",
                f"✅ 源已恢复正常 ({now})。\n\n最新探测:\n"
                + "\n".join(f"- {d}" for d in r["details"])])
            print(f"[issue] closed: {title}")


def write_summary(results):
    f = os.environ.get("GITHUB_STEP_SUMMARY")
    if not f:
        return
    emoji = {"ok": "🟢", "blocked": "🟡", "unexpected": "🟡",
             "cloudflare": "🟠", "parked": "🔴", "dead": "🔴"}
    lines = ["| 源 | 状态 | 说明 |", "|---|---|---|"]
    for r in results:
        msg = r["details"][0] if r["details"] else ""
        lines.append(
            f"| {emoji.get(r['state'], '⚪')} {r['name']} | {r['state']} | {msg} |")
    with open(f, "a", encoding="utf-8") as fh:
        fh.write("## 漫画源健康检查\n\n" + "\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="逗号分隔的源 key 列表")
    ap.add_argument("--ci", action="store_true", help="CI 模式: 管理 issue")
    args = ap.parse_args()

    only = set(filter(None, args.only.split(","))) if args.only else None
    results = run_checks(only)

    for r in results:
        print(f"{r['state']:>10s}  {r['name']:14s} {' | '.join(r['details'])}")
    down = [r for r in results if r["state"] in ISSUE_STATES and not r["declared"]]
    print(f"\n共 {len(results)} 个源, 异常 {len(down)} 个"
          + (": " + ", ".join(f"{r['name']}({r['state']})" for r in down) if down else ""))

    write_summary(results)
    if args.ci:
        if not os.environ.get("GH_TOKEN") and not os.environ.get("GITHUB_TOKEN"):
            print("CI 模式需要 GH_TOKEN 环境变量", file=sys.stderr)
            sys.exit(1)
        manage_issues(results, run_url=os.environ.get("RUN_URL", ""))


if __name__ == "__main__":
    main()
