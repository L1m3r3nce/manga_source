/** @type {import('./_venera_.js')} */
/**
 * 天才小说 (trxs.cc) — 轻小说/同人小说文本源
 * 页面为 GBK 编码, 通过 Network.fetchBytes + Convert.decodeGbk 解码。
 * 章节返回文本内容, 需要 venera 1.6.4+ 的文本章节支持。
 */
class TRXS extends ComicSource {
  name = "天才小说";
  key = "trxs";
  version = "1.0.0";
  minAppVersion = "1.6.4";
  url = "https://cdn.jsdelivr.net/gh/l1m3r3nce/manga_source@main/trxs.js";

  static host = "https://www.trxs.cc";
  static UA =
    "Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

  headers = { "User-Agent": TRXS.UA };

  /** GBK 页面获取: 返回已解码的字符串 */
  async fetchGbk(url, method, data) {
    const res = await Network.fetchBytes(
      method || "GET",
      url,
      this.headers,
      data,
    );
    if (res.status !== 200) {
      throw `Invalid status code: ${res.status}`;
    }
    return Convert.decodeGbk(res.body);
  }

  /** 相对地址转绝对地址(避免依赖宿主是否提供 URL 类) */
  absUrl(src) {
    if (!src) return "";
    if (src.startsWith("http")) return src;
    if (src.startsWith("/")) return TRXS.host + src;
    return TRXS.host + "/" + src;
  }

  /** percent-encode 字符串的 GBK 字节 (用于搜索表单) */
  pctEncodeGbk(str) {
    const bytes = new Uint8Array(Convert.encodeGbk(str));
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
      const c = String.fromCharCode(bytes[i]);
      if (/[A-Za-z0-9\-_.~]/.test(c)) {
        out += c;
      } else {
        out += "%" + bytes[i].toString(16).toUpperCase().padStart(2, "0");
      }
    }
    return out;
  }

  /** 从列表/搜索结果页解析书籍条目 */
  parseBooks(html) {
    const doc = new HtmlDocument(html);
    return doc.querySelectorAll("div.bk").map((e) => {
      const a = e.querySelector("a");
      const img = e.querySelector("img");
      const h3 = e.querySelector("h3");
      let href = a ? a.attributes["href"] : "";
      let id = "";
      const m = href && href.match(/\/tongren\/(\d+)\.html/);
      if (m) id = m[1];
      let title = "";
      if (h3 && h3.text) {
        // "书名(1-103)" -> 去掉进度尾巴
        title = h3.text.trim().replace(/\(\d+(-\d+)?\)$/, "");
      } else if (img) {
        title = img.attributes["alt"] || "";
      }
      const cover = img ? this.absUrl(img.attributes["src"]) : "";
      const news = e.querySelector("div.booknews");
      const author = news
        ? (news.text.split("作者:")[1] || "").split(/\s{2,}/)[0].trim()
        : "";
      const p = e.querySelector("p");
      const description = p ? p.text.trim().slice(0, 120) : "";
      return new Comic({
        id,
        title,
        cover,
        description,
        tags: author ? [author] : [],
      });
    }).filter((c) => c.id && c.title);
  }

  explore = [
    {
      title: "同人小说",
      type: "multiPageComicList",
      load: async (page) => {
        const url = page <= 1
          ? `${TRXS.host}/tongren/`
          : `${TRXS.host}/tongren/index_${page}.html`;
        const html = await this.fetchGbk(url);
        return {
          comics: this.parseBooks(html),
          maxPage: 100,
        };
      },
    },
  ];

  search = {
    load: async (keyword, _, page) => {
      const body = `keyboard=${this.pctEncodeGbk(keyword)}&show=title&classid=0`;
      const html = await this.fetchGbk(
        `${TRXS.host}/e/search/index.php`,
        "POST",
        body,
      );
      return {
        comics: this.parseBooks(html),
        maxPage: 1,
      };
    },
  };

  comic = {
    loadInfo: async (id) => {
      const html = await this.fetchGbk(`${TRXS.host}/tongren/${id}.html`);
      const doc = new HtmlDocument(html);

      let title = "";
      const t = html.match(/<title>([^<]*)<\/title>/);
      if (t) {
        title = t[1].split("_")[0].replace(/\([^)]*\)$/, "").trim();
      }

      let author = "";
      const am = html.match(/作者[：:]\s*<a[^>]*>([^<]+)<\/a>/);
      if (am) author = am[1].trim();

      // 简介: booktips 之后的 <p> 块
      let description = "";
      const i = html.indexOf('class="booktips"');
      if (i > 0) {
        const seg = html.slice(i, i + 2000);
        const ps = seg.match(/<p>([\s\S]*?)<\/p>/);
        if (ps) {
          description = ps[1].replace(/<br\s*\/?>/g, "\n").replace(
            /<[^>]+>/g,
            "",
          ).trim();
        }
      }

      const img = doc.querySelector("div.bookcover img") ||
        doc.querySelector("img");
      const cover = img && img.attributes["src"] &&
          !img.attributes["src"].includes("spacer")
        ? this.absUrl(img.attributes["src"])
        : "";

      const chapters = {};
      const seen = new Set();
      const chapRe = /<li>\s*<a href=['"]?\/tongren\/(\d+)\/(\d+)\.html['"]?[^>]*>\s*([^<]{1,80})</g;
      let m;
      while ((m = chapRe.exec(html)) !== null) {
        const bookId = m[1], chNum = m[2];
        let chTitle = m[3].trim();
        if (!chTitle) continue;
        const key = `${bookId}/${chNum}`;
        if (seen.has(key)) continue;
        seen.add(key);
        chapters[key] = chTitle;
      }

      return new ComicDetails({
        title,
        subtitle: author,
        cover,
        description,
        tags: author ? { "作者": [author] } : {},
        chapters,
      });
    },

    loadEp: async (comicId, epId) => {
      // epId 形如 "6201/3"
      const html = await this.fetchGbk(`${TRXS.host}/tongren/${epId}.html`);
      const doc = new HtmlDocument(html);
      const nameEl = doc.querySelector("div.read_chapterName");
      let chapterName = "";
      if (nameEl) {
        const firstLine = nameEl.text.trim().split("\n")[0];
        chapterName = firstLine.trim();
      }

      const detail = doc.querySelector("div.read_chapterDetail");
      if (!detail) throw "Chapter content not found";

      let paragraphs = detail
        .querySelectorAll("p")
        .map((p) => p.text.trim())
        .filter((t) => t.length > 0);

      // 去掉正文前的书名/作者/简介铺垫: 截断到形如 "第N章/节" 的标题段
      const titleIdx = paragraphs.findIndex((p) =>
        /^第.{1,15}[章节卷回话]/.test(p)
      );
      if (titleIdx > 0) {
        paragraphs = paragraphs.slice(titleIdx);
        // 过滤站内广告段(保留首段标题)
        paragraphs = paragraphs.filter(
          (p, i) => i === 0 || !/trxs\.cc|同人小说网|首发域名|请记住本书/i.test(p),
        );
      }

      return {
        type: "text",
        title: chapterName,
        content: paragraphs.join("\n\n"),
      };
    },
  };
}
