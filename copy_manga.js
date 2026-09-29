/** @type {import('./_venera_.js')} */
/**
 * 拷贝漫画 (2026新版 — 网页版SSR + AES解密)
 * 通路: www.copy4000.com SSR列表 → comicdetail API(AES) → 章节页SSR(AES) → 图片
 */
class CopyMangaWeb extends ComicSource {
  name = "拷贝漫画";
  key = "copy_manga";
  version = "2.0.0";
  minAppVersion = "1.2.1";
  url = "https://cdn.jsdelivr.net/gh/l1m3r3nce/manga_source@main/copy_manga.js";

  static host = "www.copy4000.com";
  static key_ = "op0zzpvv.nmn.00p"; // AES-128 key (16 bytes, global)

  settings = {
    domains: {
      title: "域名",
      type: "select",
      options: [
        { value: "www.copy4000.com" },
        { value: "www.copy5000.com" },
      ],
      default: "www.copy4000.com",
    },
    image_quality: {
      title: "图片质量",
      type: "select",
      options: [
        { value: "c1500x", text: "1500px" },
        { value: "c800x", text: "800px" },
        { value: "", text: "原图" },
      ],
      default: "c1500x",
    },
  };

  get baseUrl() {
    return `https://${this.loadSetting("domains") || this.settings.domains.default}`;
  }

  headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
  };

  apiHeaders(extra) {
    return {
      ...this.headers,
      "X-Requested-With": "XMLHttpRequest",
      "Accept": "application/json",
      ...(extra || {}),
    };
  }

  /** AES-128-CBC 解密 (key=固定16字节, IV=密文前16字符UTF-8, 剩余hex解码) */
  decrypt(encrypted) {
    if (!encrypted || encrypted.length < 32) return null;
    const key = Convert.encodeUtf8(CopyMangaWeb.key_);
    const iv = Convert.encodeUtf8(encrypted.substring(0, 16));
    const ctHex = encrypted.substring(16);
    const ct = this.hexToBytes(ctHex);
    const decrypted = Convert.decryptAesCbc(ct, key, iv);
    if (!decrypted) return null;
    return Convert.decodeUtf8(decrypted);
  }

  /** hex string -> ArrayBuffer */
  hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes.buffer;
  }

  /** 解析SSR列表页的漫画卡片 */
  parseComics(html) {
    const doc = new HtmlDocument(html);
    return doc.querySelectorAll("a").map((a) => {
      const href = a.attributes["href"] || "";
      const m = href.match(/^\/comic\/([a-z0-9_-]+)$/);
      if (!m) return null;
      const img = a.querySelector("img");
      let cover = img ? (img.attributes["data-src"] || img.attributes["src"] || "") : "";
      if (cover.includes("loading") || cover.includes("default")) cover = "";
      if (cover.startsWith("//")) cover = "https:" + cover;
      if (cover && !cover.startsWith("http")) {
        cover = `https://sa.mangafunb.fun${cover}`;
      }
      // 封面 URL 格式: /a/{id}/cover/{ts}.jpg.328x422.jpg
      if (!cover && m[1]) {
        cover = ""; // 无封面时留空
      }
      // 标题: img alt 或 a 的 title
      let title = "";
      if (img) title = (img.attributes["alt"] || "").trim();
      if (!title) {
        title = a.text.trim().split("\n")[0];
      }
      return new Comic({ id: m[1], title, cover, tags: [] });
    }).filter((c) => c.id && c.title);
  }

  explore = [
    {
      title: "拷贝漫画",
      type: "multiPageComicList",
      load: async (page) => {
        const themes = ["love", "harem", "adventure", "fantasy", "science", "mystery"];
        const theme = themes[Math.min(page - 1, themes.length - 1)];
        const res = await Network.get(
          `${this.baseUrl}/comics?theme=${theme}&offset=0&limit=20`,
          this.headers,
        );
        if (res.status !== 200) throw `Invalid status: ${res.status}`;
        return {
          comics: this.parseComics(res.body),
          maxPage: themes.length,
        };
      },
    },
  ];

  search = {
    load: async (keyword, page) => {
      // 网页搜索暂未破解, 用发现页代替
      const res = await Network.get(
        `${this.baseUrl}/comics?theme=all&offset=0&limit=100`,
        this.headers,
      );
      if (res.status !== 200) throw `Invalid status: ${res.status}`;
      const comics = this.parseComics(res.body).filter((c) =>
        c.title.toLowerCase().includes(keyword.toLowerCase()),
      );
      return { comics, maxPage: 1 };
    },
  };

  comic = {
    loadInfo: async (id) => {
      // 1. 章节列表 API (AES加密)
      const chRes = await Network.get(
        `${this.baseUrl}/comicdetail/${id}/chapters`,
        this.apiHeaders({ "Referer": `${this.baseUrl}/comic/${id}` }),
      );
      if (chRes.status !== 200) throw `Chapters API: ${chRes.status}`;
      let chData;
      try {
        const j = JSON.parse(chRes.body);
        if (j.code !== 200 || !j.results) throw j.message || "API error";
        const decrypted = this.decrypt(j.results);
        chData = JSON.parse(decrypted);
      } catch (e) {
        throw `Failed to decrypt chapters: ${e}`;
      }

      // 2. 详情页 SSR (基本信息)
      const detRes = await Network.get(
        `${this.baseUrl}/comic/${id}`,
        this.headers,
      );
      let title = id;
      let cover = "";
      let description = "";
      if (detRes.status === 200) {
        const t = detRes.body.match(/<title>([^<]+)<\/title>/);
        if (t) title = t[1].split("-")[0].trim();
        const c = detRes.body.match(
          /(https:\/\/[a-z0-9.-]+\.mangafun[a-z]?\.[a-z]+\/a\/[^"\s]+cover[^"\s]+)/,
        );
        if (c) cover = c[1].replace(/&#x27;$/, "");
        const d = detRes.body.match(
          /<meta[^>]*name="description"[^>]*content="([^"]{10,300})"/,
        );
        if (d) description = d[1];
      }

      // 3. 构建章节映射
      const chapters = {};
      const groups = chData.groups || {};
      for (const gName of Object.keys(groups)) {
        const group = groups[gName];
        for (const ch of group.chapters || []) {
          chapters[ch.id] = ch.name || `第${ch.id.substring(0, 8)}话`;
        }
      }
      if (Object.keys(chapters).length === 0) throw "No chapters found";

      return new ComicDetails({
        title,
        cover,
        description,
        tags: {},
        chapters,
      });
    },

    loadEp: async (comicId, epId) => {
      const res = await Network.get(
        `${this.baseUrl}/comic/${comicId}/chapter/${epId}`,
        this.headers,
      );
      if (res.status !== 200) throw `Invalid status: ${res.status}`;

      // 从页面提取 cct + contentKey 并解密
      const scripts = res.body.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
      for (const s of scripts) {
        const km = s.match(/cct\s*=\s*['"]([^'"]+)['"]/);
        const cm = s.match(/contentKey\s*=\s*['"](.+?)['"]/);
        if (km && cm) {
          const key = Convert.encodeUtf8(km[1]);
          const iv = Convert.encodeUtf8(cm[1].substring(0, 16));
          const ct = this.hexToBytes(cm[1].substring(16));
          const decrypted = Convert.decryptAesCbc(ct, key, iv);
          if (!decrypted) throw "Decrypt failed";
          const text = Convert.decodeUtf8(decrypted);
          const images = JSON.parse(text).map((item) => {
            let url = item.url || "";
            // 替换质量参数
            const q = this.loadSetting("image_quality") || "c1500x";
            if (q) {
              url = url.replace(/\.c\d+x\./, `.${q}.`);
            }
            return url;
          });
          if (images.length === 0) throw "No images found";
          return { images };
        }
      }
      throw "Encrypted content not found in page";
    },
  };
}
