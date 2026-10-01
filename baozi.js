/** @type {import('./_venera_.js')} */
/**
 * 包子漫画 (2026新版Web)
 * 通路: appcn.baozimh.com (Nuxt SSR, 图片列表最全且slug正确) → {lang}.webmota.com AMP 兜底
 * 2026-10: webmota AMP 章节页对部分漫画会返回"换slug"的引流图(整章替换成别的漫画),
 * appcn 端点的 data-src 才是真实图床地址; 封面 static-*.baozimh.com 被 CF 挡时改走 s.baozicdn.com
 */
class Baozi extends ComicSource {
  name = "包子漫画";
  key = "baozi";
  version = "1.2.4";
  minAppVersion = "1.2.1";
  url = "https://cdn.jsdelivr.net/gh/l1m3r3nce/manga_source@main/baozi.js";

  static UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

  static APPCN = "https://appcn.baozimh.com/baozimhapp";

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
        { value: "s1.baozicdn.com" },
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

  /** static-*.baozimh.com/cover 被 Cloudflare 挡时, 等价封面在 s.baozicdn.com/baozimhapp/cover (无CF) */
  fixCover(u) {
    if (!u) return u;
    u = u.replace(/&amp;/g, "&");
    return u.replace(
      /^https?:\/\/static[^./]*\.baozimh\.com\/cover\//,
      "https://s.baozicdn.com/baozimhapp/cover/",
    );
  }

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
        cover = this.fixCover(cover);
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
      let cover = this.fixCover(
        `https://static-tw.baozimh.com/cover/${id}.jpg`,
      );
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
        cover = this.fixCover(im[2]);
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
      const cdn = this.loadSetting("cdn_domains") || "";

      /**
       * appcn 端点 2026-10 起为 Nuxt SSR 页面: 正文图片全部在 data-src 属性里,
       * comic-contain__item 只出现在 CSS 定义中(旧正则因此一图不中, 只剩 <img src> 兜底捞到1张).
       * webmota AMP 页: amp-img 的 src/data-src 成对出现.
       * 统一策略: 先扫 data-src 再扫 img src, 只认 /scomic/ 路径, 以首个命中图片所在目录锁定本章,
       * 避免把推荐位/其他章的图混进来.
       */
      const extract = (html) => {
        const seen = new Set();
        const images = [];
        let dir = null;
        const push = (raw) => {
          let u = raw.replace(/&amp;/g, "&");
          if (!/\/scomic\//.test(u)) return;
          if (cdn) {
            u = u.replace(/^(https?:\/\/)[^/]+/, `$1${cdn}`);
          }
          const d = u.slice(0, u.lastIndexOf("/") + 1);
          if (dir === null) dir = d;
          if (d !== dir) return;
          // 版本参数: 强制更换缓存键, 避免命中此前被引流图污染的缓存(服务端忽略该参数)
          u += (u.includes("?") ? "&" : "?") + "_kv=124";
          if (!seen.has(u)) {
            seen.add(u);
            images.push(u);
          }
        };
        let m;
        let re = /data-src="(https?:\/\/[^"]+\.(?:jpe?g|png|webp)[^"]*)"/g;
        while ((m = re.exec(html)) !== null) push(m[1]);
        re = /<(?:amp-)?img[^>]*\ssrc="(https?:\/\/[^"]+\.(?:jpe?g|png|webp)[^"]*)"/g;
        while ((m = re.exec(html)) !== null) push(m[1]);
        return images;
      };

      // 优先 appcn: 图片列表完整且 slug 正确, CF挑战会由App弹WebView自动续期 cf_clearance
      let res = await Network.get(
        `${Baozi.APPCN}/comic/chapter/${fullId}/${s}_${c}.html`,
        this.headers,
      );
      if (res.status === 200) {
        const images = extract(res.body);
        if (images.length > 0) return { images };
      }

      // 兜底 webmota AMP (注意: 部分漫画该页图片会被换成引流内容, 属最后手段)
      res = await Network.get(
        `${this.baseUrl}/comic/chapter/${fullId}/${s}_${c}.html`,
        this.headers,
      );
      if (res.status !== 200) throw `Invalid status: ${res.status}`;
      const images = extract(res.body);
      if (images.length === 0) throw "No images found";
      return { images };
    },
  };

  /** 图片/封面请求补 Referer, 降低图床防盗链误伤 */
  onImageLoad(url, comicId, epId) {
    return {
      headers: {
        "User-Agent": Baozi.UA,
        "Referer": `${Baozi.APPCN}/`,
      },
    };
  }

  onThumbnailLoad(url) {
    return {
      headers: {
        "User-Agent": Baozi.UA,
        "Referer": `${Baozi.APPCN}/`,
      },
    };
  }
}
