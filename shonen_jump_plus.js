class ShonenJumpPlus extends ComicSource {
  name = "少年ジャンプ＋";
  key = "shonen_jump_plus";
  version = "1.2.0";
  minAppVersion = "1.2.1";
  url =
    "https://cdn.jsdelivr.net/gh/l1m3r3nce/manga_source@main/shonen_jump_plus.js";

  static UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

  webHeaders = {
    "User-Agent": ShonenJumpPlus.UA,
    "Referer": "https://shonenjumpplus.com/",
  };

  decodeEntities(s) {
    return (s || "")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&amp;/g, "&");
  }

  seriesIdFromUrl(url) {
    try {
      const decoded = decodeURIComponent(url || "");
      const m = decoded.match(/series-thumbnail[/|\\](\d+)-/);
      if (m) return m[1];
    } catch (e) {}
    const raw = (url || "").match(/series-thumbnail\/(\d+)-/);
    return raw ? raw[1] : null;
  }

  // /series, /series/finished, /series/oneshot share the same list markup
  parseListPage(body) {
    const doc = new HtmlDocument(body);
    return doc.querySelectorAll("li.series-list-item").map((e) => {
      const a = e.querySelector("a");
      const img = e.querySelector("img");
      const title = e.querySelector("h2.series-list-title")?.text?.trim() ||
        e.querySelector("h2")?.text?.trim() || "";
      const author = e.querySelector("h3.series-list-author")?.text?.trim() ||
        "";
      const tagline = e.querySelector("p.series-list-tagline")?.text?.trim() ||
        "";
      let cover = "";
      let id = null;
      if (img) {
        cover = img.attributes["data-src"] || img.attributes["src"] || "";
        if (cover.includes("spacer.png")) cover = "";
        if (cover.startsWith("https://cdn-scissors")) {
          try {
            const decoded = decodeURIComponent(cover);
            const m = decoded.match(
              /https:\/\/cdn-ak-img\.shonenjumpplus\.com\/public\/series-thumbnail\/\d+-[\w]+/,
            );
            if (m) cover = m[0];
          } catch (e) {}
        }
        id = this.seriesIdFromUrl(cover);
      }
      return new Comic({
        id: id || (a ? a.attributes["href"] : title),
        title,
        cover,
        description: tagline,
        tags: author ? [author] : [],
      });
    }).filter((c) => c.id && /^\d+$/.test(c.id));
  }

  explore = [
    {
      title: "連載一覧",
      type: "singlePageWithMultiPart",
      load: async () => {
        const res = await Network.get(
          "https://shonenjumpplus.com/series",
          this.webHeaders,
        );
        if (res.status !== 200) throw `Invalid status: ${res.status}`;
        return { "連載中": this.parseListPage(res.body) };
      },
    },
    {
      title: "連載終了作品",
      type: "singlePageWithMultiPart",
      load: async () => {
        const res = await Network.get(
          "https://shonenjumpplus.com/series/finished",
          this.webHeaders,
        );
        if (res.status !== 200) throw `Invalid status: ${res.status}`;
        return { "完結": this.parseListPage(res.body) };
      },
    },
    {
      title: "読切シリーズ",
      type: "singlePageWithMultiPart",
      load: async () => {
        const res = await Network.get(
          "https://shonenjumpplus.com/series/oneshot",
          this.webHeaders,
        );
        if (res.status !== 200) throw `Invalid status: ${res.status}`;
        return { "読切": this.parseListPage(res.body) };
      },
    },
  ];

  search = {
    load: async (keyword, _, page) => {
      const res = await Network.get(
        `https://shonenjumpplus.com/search?q=${encodeURIComponent(keyword)}`,
        this.webHeaders,
      );
      if (res.status !== 200) throw `Invalid status: ${res.status}`;
      const doc = new HtmlDocument(res.body);
      const comics = doc.querySelectorAll(".search-series-list li").map((e) => {
        const img = e.querySelector("img");
        const title = e.querySelector("p.series-title")?.text?.trim() ||
          e.attributes["data-title"] || "";
        const author = e.querySelector("p.author")?.text?.trim() || "";
        const cover = img ? (img.attributes["src"] || "") : "";
        const id = this.seriesIdFromUrl(cover);
        return { title, author, cover, id };
      }).filter((c) => c.id)
        .map((c) =>
          new Comic({
            id: c.id,
            title: c.title,
            cover: c.cover,
            tags: c.author ? [c.author] : [],
          })
        );
      return { comics, maxPage: 1 };
    },
  };

  // Parse /atom/series/{id} feed (XML) with regex to avoid parser quirks
  parseAtomFeed(body) {
    const titleMatch = body.match(
      /<title[^>]*>[^<]*（([^<)]+)）<\/title>/,
    ) || body.match(/<title[^>]*>([^<]+)<\/title>/);
    const seriesTitle = titleMatch ? this.decodeEntities(titleMatch[1]).trim() : "";
    const subtitleMatch = body.match(/<subtitle[^>]*>([\s\S]*?)<\/subtitle>/);
    const description = subtitleMatch
      ? this.decodeEntities(this.decodeEntities(subtitleMatch[1])).trim()
      : "";
    const feedLinkMatch = body.match(
      /<link href="(https:\/\/shonenjumpplus\.com\/episode\/\d+)"[^>]*\/?>/,
    );
    const latestEpisodeUrl = feedLinkMatch ? feedLinkMatch[1] : "";
    const entries = [];
    const entryRe =
      /<entry>\s*<title>([\s\S]*?)<\/title>\s*<link href="(https:\/\/shonenjumpplus\.com\/episode\/(\d+))"[\s\S]*?<updated>([^<]+)<\/updated>/g;
    let m;
    while ((m = entryRe.exec(body)) !== null) {
      entries.push({
        title: this.decodeEntities(m[1]).trim(),
        url: m[2],
        id: m[3],
        updated: m[4],
      });
    }
    // feed is newest-first; reading order is oldest-first
    entries.reverse();
    return { seriesTitle, description, latestEpisodeUrl, entries };
  }

  comic = {
    loadInfo: async (id) => {
      const res = await Network.get(
        `https://shonenjumpplus.com/atom/series/${id}`,
        this.webHeaders,
      );
      if (res.status !== 200) throw `Invalid status: ${res.status}`;
      const feed = this.parseAtomFeed(res.body);
      if (!feed.entries.length) throw "No episodes found";

      const chapters = {};
      for (const e of feed.entries) {
        chapters[e.id] = e.title;
      }
      const latest = feed.entries[feed.entries.length - 1].updated;

      return new ComicDetails({
        title: feed.seriesTitle,
        subtitle: "",
        description: feed.description,
        tags: {
          "Update": [latest.slice(0, 10)],
        },
        url: feed.latestEpisodeUrl,
        chapters,
      });
    },

    loadEp: async (comicId, epId) => {
      const episodeId = typeof epId === "object" ? epId.id : epId;
      const res = await Network.get(
        `https://shonenjumpplus.com/episode/${episodeId}`,
        this.webHeaders,
      );
      if (res.status !== 200) throw `Invalid status: ${res.status}`;
      const m = res.body.match(
        /<script[^>]*id=['"]episode-json['"][^>]*data-value='([^']*)'/,
      );
      if (!m) throw "episode-json not found";
      let data;
      try {
        data = JSON.parse(this.decodeEntities(m[1]));
      } catch (e) {
        throw "Failed to parse episode json";
      }
      const pages = data?.readableProduct?.pageStructure?.pages || [];
      const images = pages.filter((p) => p.type === "main" && p.src).map((
        p,
      ) => p.src);
      if (!images.length) throw "No images found";
      return { images };
    },
  };
}
