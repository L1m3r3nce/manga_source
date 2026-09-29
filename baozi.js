/** @type {import('./_venera_.js')} */
/**
 * 包子漫画 (2026新版Web)
 * 通路: {lang}.webmota.com 列表/详情 → /user/page_direct 302 → 章节SSR直出图片
 */
class Baozi extends ComicSource {
  name = "包子漫画";
  key = "baozi";
  version = "1.2.1";
  minAppVersion = "1.2.1";
  url = "https://cdn.jsdelivr.net/gh/l1m3r3nce/manga_source@main/baozi.js";

  static UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

  settings = {
    language: {
      title: "简繁切换",
      type: "select",
      options: [
        { value: "cn", text: "简体" },
        { value: "tw", text: "繁體" },
      ],
      default: "cn",
    },
    domains: {
      title: "主域名",
      type: "select",
      options: [
        { value: "webmota.com" },
        { value: "kukuc.co" },
        { value: "baozimhcn.com" },
        { value: "dinnerku.com" },
      ],
      default: "webmota.com",
    },
    cdn_domains: {
      title: "图片CDN",
      type: "select",
      options: [
        { value: "", text: "默认" },
        { value: "s1.bzcdn.net" },
        { value: "ascn-a3.bzcdn.net" },
        { value: "asgb-a3.bzcdn.net" },
        { value: "as-rsa1-usla.baozicdn.com" },
      ],
      default: "",
    },
  };

  get lang() {
    return this.loadSetting("language") || this.settings.language.default;
  }

  get baseUrl() {
    let d = this.loadSetting("domains") || this.settings.domains.default;
    return `https://${this.lang}.${d}`;
  }

  headers = {
    "User-Agent": Baozi.UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
  };

  /** 从列表/搜索页解析漫画卡片 (a > amp-img) */
  parseCards(html) {
    const doc = new HtmlDocument(html);
    return doc
      .querySelectorAll("a")
      .map((a) => {
        const href = a.attributes["href"] || "";
        const m = href.match(/^\/comic\/([a-z0-9_-]+)/);
        if (!m) return null;
        const img = a.querySelector("amp-img") || a.querySelector("img");
        if (!img) return null;
        const title = (img.attributes["alt"] || "").trim();
        let cover = img.attributes["src"] || "";
        if (cover.includes("default_cover")) return null;
        if (cover.startsWith("http")) {
          cover = cover.replace(/&amp;/g, "&");
        }
        return new Comic({ id: m[1], title, cover, tags: [] });
      })
      .filter(Boolean);
  }

  explore = [
    {
      title: "包子漫画",
      type: "multiPageComicList",
      load: async (page) => {
        const res = await Network.get(`${this.baseUrl}/list/new`, this.headers);
        if (res.status !== 200) throw `Invalid status: ${res.status}`;
        return { comics: this.parseCards(res.body), maxPage: 1 };
      },
    },
    {
      title: "分类",
      type: "multiPageComicList",
      load: async (page) => {
        const res = await Network.get(
          `${this.baseUrl}/classify`,
          this.headers,
        );
        if (res.status !== 200) throw `Invalid status: ${res.status}`;
        return { comics: this.parseCards(res.body), maxPage: 1 };
      },
    },
  ];

  search = {
    load: async (keyword, page) => {
      const res = await Network.get(
        `${this.baseUrl}/search?q=${encodeURIComponent(keyword)}`,
        this.headers,
      );
      if (res.status !== 200) throw `Invalid status: ${res.status}`;
      const seen = new Set();
      const comics = this.parseCards(res.body).filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
      return { comics, maxPage: 1 };
    },
  };

  comic = {
    loadInfo: async (id) => {
      const res = await Network.get(
        `${this.baseUrl}/comic/${id}`,
        this.headers,
      );
      if (res.status !== 200) throw `Invalid status: ${res.status}`;
      const html = res.body;

      let title = id;
      let cover = `https://static-tw.baozimh.com/cover/${id}.jpg`;
      // canonical URL 中提取完整ID后缀hash, 用于直接构造章节页地址
      let fullId = id;
      const cm = html.match(
        /rel="canonical"\s+href="https?:\/\/[^"\/]+\/comic\/([a-z0-9_-]+)"/,
      );
      if (cm) fullId = cm[1];
      const im = html.match(
        /<amp-img[^>]*alt="([^"]+)"[^>]*src="(https:\/\/static[^"\s]+cover\/[^"\s]+)"/,
      );
      if (im) {
        title = im[1];
        cover = im[2].replace(/&amp;/g, "&");
      }

      let description = "";
      const dm = html.match(
        /<meta[^>]*name="description"[^>]*content="([^"]{10,300})"/,
      );
      if (dm) description = dm[1];

      // 页面章节为倒序(最新在前), 收集后反转为正序
      const list = [];
      const seenKeys = new Set();
      const re =
        /href="\/user\/page_direct\?comic_id=[^"&]+&(?:amp;)?section_slot=(\d+)&(?:amp;)?chapter_slot=(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        const key = `${m[1]}-${m[2]}@${fullId}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const name = m[3].replace(/<[^>]+>/g, "").trim();
        list.push([key, name || `第${parseInt(m[2]) + 1}话`]);
      }
      if (list.length === 0) throw "No chapters found";
      // 页面顺序不可靠(首尾混有推荐链接), 按 section+chapter 数值排序
      list.sort((a, b) => {
        const [sa, ca] = a[0].split("@")[0].split("-").map(Number);
        const [sb, cb] = b[0].split("@")[0].split("-").map(Number);
        return sa - sb || ca - cb;
      });
      const chapters = {};
      for (const [k, n] of list) chapters[k] = n;

      return new ComicDetails({
        title,
        cover,
        description,
        tags: {},
        chapters,
      });
    },

    loadEp: async (comicId, epId) => {
      // epId = "{section}-{chapter}@{fullId}"
      const [slots, fullId] = epId.split("@");
      const [s, c] = slots.split("-");
      const url =
        `${this.baseUrl}/comic/chapter/${fullId}/${s}_${c}.html`;
      const res = await Network.get(url, this.headers);
      if (res.status !== 200) throw `Invalid status: ${res.status}`;

      const doc = new HtmlDocument(res.body);
      const cdn = this.loadSetting("cdn_domains") || "";
      const images = doc
        .querySelectorAll("img")
        .map((img) => img.attributes["src"] || "")
        .filter((u) => /scomic|bzcdn|baozicdn/.test(u))
        .map((u) => {
          u = u.replace(/&amp;/g, "&");
          if (cdn) {
            u = u.replace(/^(https?:\/\/)[^/]+/, `$1${cdn}`);
          }
          return u;
        });
      if (images.length === 0) throw "No images found";
      return { images };
    },
  };
}
