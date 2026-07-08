class CopyManga extends ComicSource {

    name = "拷贝漫画"

    key = "copy_manga"

    version = "1.4.4"

    minAppVersion = "1.6.0"

    url = "https://cdn.jsdelivr.net/gh/l1m3r3nce/manga_source@main/copy_manga.js"

    // ============================================================
    //  Anti-blocking: rate limiting state
    // ============================================================

    // 滑动窗口：记录最近 60 秒内的请求时间戳
    _requestTimestamps = [];

    // request_id 缓存，避免每次請求都调用广告 API
    _reqIdCache = null;
    _reqIdCacheTime = 0;

    // ============================================================
    //  Utility helpers
    // ============================================================

    /** 异步休眠 ms 毫秒 */
    static async sleep(ms) {
        await new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * 在 baseMs 基础上附加 ±rangePercent 的随机抖动
     * 例如 jitter(1000, 0.3) => 700~1300ms
     */
    static jitter(baseMs, rangePercent) {
        rangePercent = rangePercent || 0.3;
        const range = Math.floor(baseMs * rangePercent);
        return baseMs + randomInt(-range, range);
    }

    // ============================================================
    //  Rate limiter — 在每次 API 请求前调用
    // ============================================================

    /**
     * 基于滑动窗口的请求频率控制。
     * - 相邻请求间隔 >= 500ms（带随机抖动）
     * - 60 秒内超过 30 次请求时自动降速
     * - 超过 50 次请求时进一步降速
     */
    async _rateLimit() {
        const now = Date.now();
        const MIN_GAP = 500;

        // 清理 60 秒之前的时间戳
        const cutoff = now - 60000;
        this._requestTimestamps = this._requestTimestamps.filter(t => t > cutoff);

        // 确保相邻请求之间有最小间隔
        if (this._requestTimestamps.length > 0) {
            const lastTime = this._requestTimestamps[this._requestTimestamps.length - 1];
            const elapsed = now - lastTime;
            if (elapsed < MIN_GAP) {
                const waitMs = (MIN_GAP - elapsed) + randomInt(0, 300);
                await CopyManga.sleep(waitMs);
            }
        }

        // 根据窗口内请求数量，按比例增加延迟
        const count = this._requestTimestamps.length;
        if (count > 50) {
            // 超过 50 次/分钟 — 大幅降速
            await CopyManga.sleep(randomInt(3000, 6000));
        } else if (count > 30) {
            // 超过 30 次/分钟 — 中度降速
            await CopyManga.sleep(randomInt(1000, 2500));
        }

        // 在可能的 sleep 之后重新获取时间，确保时间戳准确
        this._requestTimestamps.push(Date.now());
    }

    // ============================================================
    //  Request ID — 带缓存，减少广告 API 调用
    // ============================================================

    async getReqID() {
        if (this.copyRegion === "0") {
            return "";
        }

        // 缓存 30 分钟（广告 API 的 request_id 通常有较长有效期）
        const now = Date.now();
        const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
        if (this._reqIdCache && (now - this._reqIdCacheTime) < CACHE_TTL) {
            return this._reqIdCache;
        }

        const reqIdUrl = "https://marketing.aiacgn.com/api/v2/adopr/query3/?format=json&ident=200100001";
        let reqId = "";
        try {
            const response = await Network.get(reqIdUrl, this.headers);

            if (response.status === 200) {
                const data = JSON.parse(response.body);
                reqId = data.results.request_id;
                // 只有成功获取时才更新缓存
                this._reqIdCache = reqId;
                this._reqIdCacheTime = now;
            }
        } catch (e) {
            // 如果请求失败但有旧缓存，继续使用旧缓存
            if (this._reqIdCache) {
                return this._reqIdCache;
            }
        }
        return reqId;
    }

    // ============================================================
    //  App version / secret — 可从设置中覆盖
    // ============================================================

    get appVersion() {
        return this.loadSetting('app_version') || '3.0.9';
    }

    get appSecret() {
        return this.loadSetting('app_secret') || "M2FmMDg1OTAzMTEwMzJlZmUwNjYwNTUwYTA1NjNhNTM=";
    }

    get appUmstring() {
        return this.loadSetting('app_umstring') || "b4c89ca4104ea9a97750314d791520ac";
    }

    // ============================================================
    //  Headers
    // ============================================================

    get headers() {
        let token = this.loadData("token");
        let secret = this.appSecret;

        let now = new Date(Date.now());
        let year = now.getFullYear();
        let month = (now.getMonth() + 1).toString().padStart(2, '0');
        let day = now.getDate().toString().padStart(2, '0');
        let ts = Math.floor(now.getTime() / 1000).toString()

        if (!token) {
            token = "";
        } else {
            token = " " + token;
        }

        let sig = Convert.hmacString(
            Convert.decodeBase64(secret),
            Convert.encodeUtf8(ts),
            "sha256"
        )

        let ver = this.appVersion;

        return {
            "User-Agent": `COPY/${ver}`,
            "source": "copyApp",
            "deviceinfo": this.deviceinfo,
            "dt": `${year}.${month}.${day}`,
            "platform": "3",
            "referer": `com.copymanga.app-${ver}`,
            "version": ver,
            "device": this.device,
            "pseudoid": this.pseudoid,
            "Accept": "application/json",
            "region": this.copyRegion,
            "authorization": `Token${token}`,
            "umstring": this.appUmstring,
            "x-auth-timestamp": ts,
            "x-auth-signature": sig,
        }
    }

    // static defaultCopyVersion = "3.0.6"

    // static defaultCopyPlatform = "2"

    static defaultCopyRegion = "0"

    static defaultImageQuality = "1500"

    static defaultApiUrl = 'api.copy2000.online'

    static searchApi = "/api/kb/web/searchb/comics"

    // ============================================================
    //  Device fingerprint — 更接近真实 Android 设备
    // ============================================================

    get deviceinfo() {
        let info = this.loadData("_deviceinfo");
        if (!info) {
            info = CopyManga.generateDeviceInfo();
            this.saveData("_deviceinfo", info);
        }
        return info;
    }

    get device() {
        let dev = this.loadData("_device");
        if (!dev) {
            dev = CopyManga.generateDevice();
            this.saveData("_device", dev);
        }
        return dev;
    }

    get pseudoid() {
        let pid = this.loadData("_pseudoid");
        if (!pid) {
            pid = CopyManga.generatePseudoid();
            this.saveData("_pseudoid", pid);
        }
        return pid;
    }

    // get copyVersion() {
    //     return this.loadSetting('version')
    // }

    // get copyPlatform()
    // return this.loadSetting('platform')
    // }

    /**
     * 生成更接近真实 Android 设备的 deviceInfo。
     * 真实 Android ID 是 16 位十六进制，这里混合多种格式增加多样性。
     */
    static generateDeviceInfo() {
        const variant = randomInt(0, 2);
        switch (variant) {
            case 0: {
                // Android ID 风格: 16 位十六进制
                const hex = '0123456789abcdef';
                let id = '';
                for (let i = 0; i < 16; i++) id += hex[randomInt(0, 15)];
                return id;
            }
            case 1: {
                // 旧格式: 7位数字-V-4位数字
                return `${randomInt(1000000, 9999999)}V-${randomInt(1000, 9999)}`;
            }
            case 2: {
                // UUID 风格: 8-4-4-4-12 十六进制
                const hex = '0123456789abcdef';
                const seg = (n) => { let s = ''; for (let i = 0; i < n; i++) s += hex[randomInt(0, 15)]; return s; };
                return `${seg(8)}-${seg(4)}-${seg(4)}-${seg(4)}-${seg(12)}`;
            }
        }
    }

    /**
     * 生成更接近真实 Android 设备的 device 标识。
     * 混合多种格式：原格式 + 序列号风格 + MAC 地址风格
     */
    static generateDevice() {
        function randCharA() {
            return String.fromCharCode(65 + randomInt(0, 25));
        }
        function randDigit() {
            return String.fromCharCode(48 + randomInt(0, 9));
        }

        const variant = randomInt(0, 2);
        switch (variant) {
            case 0:
                // 原有格式: XX#X.######.###
                return (
                    randCharA() +
                    randCharA() +
                    randDigit() +
                    randCharA() + "." +
                    randDigit() +
                    randDigit() +
                    randDigit() +
                    randDigit() +
                    randDigit() +
                    randDigit() + "." +
                    randDigit() +
                    randDigit() +
                    randDigit()
                );
            case 1: {
                // 序列号风格: 大写字母+数字混合，类似 Samsung 设备号
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                let s = '';
                for (let i = 0; i < 11; i++) s += chars[randomInt(0, chars.length - 1)];
                return s;
            }
            case 2: {
                // 带连字符的格式: XXXX-XXXX-XXXX
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                const seg = (n) => { let s = ''; for (let i = 0; i < n; i++) s += chars[randomInt(0, chars.length - 1)]; return s; };
                return `${seg(4)}-${seg(4)}-${seg(4)}`;
            }
        }
    }

    static generatePseudoid() {
        const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let pseudoid = '';
        for (let i = 0; i < 16; i++) {
            pseudoid += chars.charAt(randomInt(0, chars.length - 1));
        }
        return pseudoid;
    }

    get apiUrl() {
        return `https://${this.loadSetting('base_url')}`
    }

    get copyRegion() {
        return this.loadSetting('region') || this.defaultCopyRegion
    }

    get imageQuality() {
        return this.loadSetting('image_quality') || this.defaultImageQuality
    }

    init() {
        // 用于储存 { 作者名 : 英文参数 }
        this.author_path_word_dict = {}
        this.refreshSearchApi()
        this.refreshAppApi()
    }

    /// account
    /// set this to null to desable account feature
    account = {
        /// login func
        login: async (account, pwd) => {
            let salt = randomInt(1000, 9999)
            let base64 = Convert.encodeBase64(Convert.encodeUtf8(`${pwd}-${salt}`))
            let res = await Network.post(
                `${this.apiUrl}/api/v3/login`,
                {
                    ...this.headers,
                    "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
                },
                `username=${account}&password=${base64}\n&salt=${salt}&authorization=Token+`
            );
            if (res.status === 200) {
                let data = JSON.parse(res.body)
                let token = data.results.token
                this.saveData('token', token)
                return "ok"
            } else {
                throw `Invalid Status Code ${res.status}`
            }
        },
        // callback when user log out
        logout: () => {
            this.deleteData('token')
        },
        registerWebsite: null
    }

    /// explore pages
    explore = [
        {
            title: "拷贝漫画",
            type: "singlePageWithMultiPart",
            load: async () => {
                await this._rateLimit();

                let dataStr = await Network.get(
                    `${this.apiUrl}/api/v3/h5/homeIndex`,
                    this.headers
                )

                if (dataStr.status !== 200) {
                    throw `Invalid status code: ${dataStr.status}`
                }

                let data = JSON.parse(dataStr.body)

                function parseComic(comic) {
                    if (comic["comic"] !== null && comic["comic"] !== undefined) {
                        comic = comic["comic"]
                    }
                    let tags = []
                    if (comic["theme"] !== null && comic["theme"] !== undefined) {
                        tags = comic["theme"].map(t => t["name"])
                    }
                    let author = null

                    if (Array.isArray(comic["author"]) && comic["author"].length > 0) {
                        author = comic["author"][0]["name"]
                    }

                    return {
                        id: comic["path_word"],
                        title: comic["name"],
                        subTitle: author,
                        cover: comic["cover"],
                        tags: tags
                    }
                }

                let res = {}
                res["推荐"] = data["results"]["recComics"]["list"].map(parseComic)
                res["热门"] = data["results"]["hotComics"].map(parseComic)
                res["最新"] = data["results"]["newComics"].map(parseComic)
                res["完结"] = data["results"]["finishComics"]["list"].map(parseComic)
                res["今日排行"] = data["results"]["rankDayComics"]["list"].map(parseComic)
                res["本周排行"] = data["results"]["rankWeekComics"]["list"].map(parseComic)
                res["本月排行"] = data["results"]["rankMonthComics"]["list"].map(parseComic)

                return res
            }
        }
    ]

    static category_param_dict = {
        "全部": "",
        "愛情": "aiqing",
        "歡樂向": "huanlexiang",
        "冒險": "maoxian",
        "奇幻": "qihuan",
        "百合": "baihe",
        "校园": "xiaoyuan",
        "科幻": "kehuan",
        "東方": "dongfang",
        "耽美": "danmei",
        "生活": "shenghuo",
        "格鬥": "gedou",
        "轻小说": "qingxiaoshuo",
        "悬疑": "xuanyi",
        "其他": "qita",
        "神鬼": "shengui",
        "职场": "zhichang",
        "TL": "teenslove",
        "萌系": "mengxi",
        "治愈": "zhiyu",
        "長條": "changtiao",
        "四格": "sige",
        "节操": "jiecao",
        "舰娘": "jianniang",
        "竞技": "jingji",
        "搞笑": "gaoxiao",
        "伪娘": "weiniang",
        "热血": "rexue",
        "励志": "lizhi",
        "性转换": "xingzhuanhuan",
        "彩色": "COLOR",
        "後宮": "hougong",
        "美食": "meishi",
        "侦探": "zhentan",
        "AA": "aa",
        "音乐舞蹈": "yinyuewudao",
        "魔幻": "mohuan",
        "战争": "zhanzheng",
        "历史": "lishi",
        "异世界": "yishijie",
        "惊悚": "jingsong",
        "机战": "jizhan",
        "都市": "dushi",
        "穿越": "chuanyue",
        "恐怖": "kongbu",
        "C100": "comiket100",
        "重生": "chongsheng",
        "C99": "comiket99",
        "C101": "comiket101",
        "C97": "comiket97",
        "C96": "comiket96",
        "生存": "shengcun",
        "宅系": "zhaixi",
        "武侠": "wuxia",
        "C98": "C98",
        "C95": "comiket95",
        "FATE": "fate",
        "转生": "zhuansheng",
        "無修正": "Uncensored",
        "仙侠": "xianxia",
        "LoveLive": "loveLive"
    }

    category = {
        title: "拷贝漫画",
        parts: [
            {
                name: "拷贝漫画",
                type: "fixed",
                categories: ["排行"],
                categoryParams: ["ranking"],
                itemType: "category"
            },
            {
                name: "主题",
                type: "fixed",
                categories: Object.keys(CopyManga.category_param_dict),
                categoryParams: Object.values(CopyManga.category_param_dict),
                itemType: "category"
            }
        ]
    }

    categoryComics = {
        load: async (category, param, options, page) => {
            await this._rateLimit();

            let category_url;
            // 分类-排行
            if (category === "排行" || param === "ranking") {
                category_url = `${this.apiUrl}/api/v3/ranks?limit=30&offset=${(page - 1) * 30}&_update=true&type=1&audience_type=${options[0]}&date_type=${options[1]}`
            } else {
                // 分类-主题
                if (category !== undefined && category !== null) {
                    // 若传入category，则转化为对应param
                    param = CopyManga.category_param_dict[category] || "";
                }
                options = options.map(e => e.replace("*", "-"))
                category_url = `${this.apiUrl}/api/v3/comics?limit=30&offset=${(page - 1) * 30}&ordering=${options[1]}&theme=${param}&top=${options[0]}`
            }


            let res = await Network.get(
                category_url,
                this.headers
            )
            if (res.status !== 200) {
                throw `Invalid status code: ${res.status}`
            }

            let data = JSON.parse(res.body)

            function parseComic(comic) {
                //判断是否是漫画排名格式
                let sort = null
                let popular = 0
                let rise_sort = 0;
                if (comic["sort"] !== null && comic["sort"] !== undefined) {
                    sort = comic["sort"]
                    rise_sort = comic["rise_sort"]
                    popular = comic["popular"]
                }

                if (comic["comic"] !== null && comic["comic"] !== undefined) {
                    comic = comic["comic"]
                }
                let tags = []
                if (comic["theme"] !== null && comic["theme"] !== undefined) {
                    tags = comic["theme"].map(t => t["name"])
                }
                let author = null
                let author_num = 0
                if (Array.isArray(comic["author"]) && comic["author"].length > 0) {
                    author = comic["author"][0]["name"]
                    author_num = comic["author"].length
                }

                //如果是漫画排名，则描述为 排名(+升降箭头)+作者+人气
                if (sort !== null) {
                    return {
                        id: comic["path_word"],
                        title: comic["name"],
                        subTitle: author,
                        cover: comic["cover"],
                        tags: tags,
                        description: `${sort} ${rise_sort > 0 ? '▲' : rise_sort < 0 ? '▽' : '-'}\n` +
                            `${author_num > 1 ? `${author} 等${author_num}位` : author}\n` +
                            `🔥${(popular / 10000).toFixed(1)}W`
                    }
                    //正常情况的描述为更新时间
                } else {
                    return {
                        id: comic["path_word"],
                        title: comic["name"],
                        subTitle: author,
                        cover: comic["cover"],
                        tags: tags,
                        description: comic["datetime_updated"]
                    }
                }
            }

            return {
                comics: data["results"]["list"].map(parseComic),
                maxPage: (data["results"]["total"] - (data["results"]["total"] % 21)) / 21 + 1
            }
        },
        optionList: [
            {
                options: [
                    "-全部",
                    "japan-日漫",
                    "korea-韩漫",
                    "west-美漫",
                    "finish-已完结"
                ],
                notShowWhen: null,
                showWhen: Object.keys(CopyManga.category_param_dict)
            },
            {
                options: [
                    "*datetime_updated-时间倒序",
                    "datetime_updated-时间正序",
                    "*popular-热度倒序",
                    "popular-热度正序",
                ],
                notShowWhen: null,
                showWhen: Object.keys(CopyManga.category_param_dict)
            },
            {
                options: [
                    "male-男频",
                    "female-女频"
                ],
                notShowWhen: null,
                showWhen: ["排行"]
            },
            {
                options: [
                    "day-上升最快",
                    "week-最近7天",
                    "month-最近30天",
                    "total-總榜單"
                ],
                notShowWhen: null,
                showWhen: ["排行"]
            }
        ]
    }

    search = {
        load: async (keyword, options, page) => {
            await this._rateLimit();

            let author;
            if (keyword.startsWith("作者:")) {
                author = keyword.substring("作者:".length).trim();
            }
            let res;
            // 通过onClickTag传入时有"作者:"前缀，处理这种情况
            if (author && author in this.author_path_word_dict) {
                let path_word = encodeURIComponent(this.author_path_word_dict[author]);
                res = await Network.get(
                    `${this.apiUrl}/api/v3/comics?limit=30&offset=${(page - 1) * 30}&ordering=-datetime_updated&author=${path_word}`,
                    this.headers
                )
            }
            // 一般的搜索情况
            else {
                let q_type = "";
                if (options && options[0]) {
                    q_type = options[0];
                }
                keyword = encodeURIComponent(keyword)
                let search_url = this.loadSetting('search_api') === "webAPI"
                    ? `${this.apiUrl}${CopyManga.searchApi}`
                    : `${this.apiUrl}/api/v3/search/comic`
                res = await Network.get(
                    `${search_url}?limit=30&offset=${(page - 1) * 30}&q=${keyword}&q_type=${q_type}`,
                    this.headers
                )
            }
            if (res.status !== 200) {
                throw `Invalid status code: ${res.status}`
            }

            let data = JSON.parse(res.body)

            function parseComic(comic) {
                if (comic["comic"] !== null && comic["comic"] !== undefined) {
                    comic = comic["comic"]
                }
                let tags = []
                if (comic["theme"] !== null && comic["theme"] !== undefined) {
                    tags = comic["theme"].map(t => t["name"])
                }
                let author = null

                if (Array.isArray(comic["author"]) && comic["author"].length > 0) {
                    author = comic["author"][0]["name"]
                }

                return {
                    id: comic["path_word"],
                    title: comic["name"],
                    subTitle: author,
                    cover: comic["cover"],
                    tags: tags,
                    description: comic["datetime_updated"]
                }
            }

            return {
                comics: data["results"]["list"].map(parseComic),
                maxPage: (data["results"]["total"] - (data["results"]["total"] % 21)) / 21 + 1
            }
        },
        optionList: [
            {
                type: "select",
                options: [
                    "-全部",
                    "name-名称",
                    "author-作者",
                    "local-汉化组"
                ],
                label: "搜索选项"
            }
        ]
    }

    favorites = {
        multiFolder: false,
        addOrDelFavorite: async (comicId, folderId, isAdding) => {
            await this._rateLimit();

            let is_collect = isAdding ? 1 : 0
            let token = this.loadData("token");
            let reqId = await this.getReqID();
            let comicData = await Network.get(
                `${this.apiUrl}/api/v3/comic2/${comicId}?in_mainland=true&request_id=${reqId}&platform=3`,
                this.headers
            )
            if (comicData.status !== 200) {
                throw `Invalid status code: ${comicData.status}`
            }
            let comic_id = JSON.parse(comicData.body).results.comic.uuid
            let res = await Network.post(
                `${this.apiUrl}/api/v3/member/collect/comic`,
                {
                    ...this.headers,
                    "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
                },
                `comic_id=${comic_id}&is_collect=${is_collect}&authorization=Token+${token}`
            )
            if (res.status === 401) {
                throw `Login expired`;
            }
            if (res.status !== 200) {
                throw `Invalid status code: ${res.status}`
            }
            return "ok"
        },
        loadComics: async (page, folder) => {
            await this._rateLimit();

            let ordering = this.loadSetting('favorites_ordering') || '-datetime_updated';
            var res = await Network.get(
                `${this.apiUrl}/api/v3/member/collect/comics?limit=30&offset=${(page - 1) * 30}&free_type=1&ordering=${ordering}`,
                this.headers
            )

            if (res.status === 401) {
                throw `Login expired`
            }

            if (res.status !== 200) {
                throw `Invalid status code: ${res.status}`
            }

            let data = JSON.parse(res.body)

            function parseComic(comic) {
                if (comic["comic"] !== null && comic["comic"] !== undefined) {
                    comic = comic["comic"]
                }
                let tags = []
                if (comic["theme"] !== null && comic["theme"] !== undefined) {
                    tags = comic["theme"].map(t => t["name"])
                }
                let author = null

                if (Array.isArray(comic["author"]) && comic["author"].length > 0) {
                    author = comic["author"][0]["name"]
                }

                return {
                    id: comic["path_word"],
                    title: comic["name"],
                    subTitle: author,
                    cover: comic["cover"],
                    tags: tags,
                    description: comic["datetime_updated"]
                }
            }

            return {
                comics: data["results"]["list"].map(parseComic),
                maxPage: (data["results"]["total"] - (data["results"]["total"] % 21)) / 21 + 1
            }
        }
    }

    comic = {
        loadInfo: async (id) => {
            await this._rateLimit();

            let getChapters = async (id, groups) => {
                let fetchSingle = async (id, path) => {
                    await this._rateLimit();

                    let reqId = await this.getReqID();
                    let res = await Network.get(
                        `${this.apiUrl}/api/v3/comic/${id}/group/${path}/chapters?limit=100&offset=0&in_mainland=true&request_id=${reqId}`,
                        this.headers
                    );
                    if (res.status !== 200) {
                        throw `Invalid status code: ${res.status}`;
                    }
                    let data = JSON.parse(res.body);
                    let eps = new Map();
                    data.results.list.forEach((e) => {
                        let title = e.name;
                        let id = e.uuid;
                        eps.set(id, title);
                    });
                    let maxChapter = data.results.total;
                    if (maxChapter > 100) {
                        let offset = 100;
                        while (offset < maxChapter) {
                            await this._rateLimit();
                            // 批量拉取章节时加入随机间隔，避免触发频率限制
                            await CopyManga.sleep(randomInt(200, 600));

                            res = await Network.get(
                                `${this.apiUrl}/api/v3/comic/${id}/group/${path}/chapters?limit=100&offset=${offset}`,
                                this.headers
                            );
                            if (res.status !== 200) {
                                throw `Invalid status code: ${res.status}`;
                            }
                            data = JSON.parse(res.body);
                            data.results.list.forEach((e) => {
                                let title = e.name;
                                let id = e.uuid;
                                eps.set(id, title)
                            });
                            offset += 100;
                        }
                    }
                    return eps;
                };
                let keys = Object.keys(groups);
                let result = {};
                let futures = [];
                // 为并行请求之间加入微小错峰，避免同时发出大量请求
                for (let i = 0; i < keys.length; i++) {
                    let group = keys[i];
                    let path = groups[group]["path_word"];
                    // 每个分组错开 300~600ms 发出请求
                    if (i > 0) {
                        await CopyManga.sleep(randomInt(300, 600));
                    }
                    futures.push((async () => {
                        result[group] = await fetchSingle(id, path);
                    })());
                }
                await Promise.all(futures);
                if (this.isAppVersionAfter("1.3.0")) {
                    // 支持多分组
                    let sortedResult = new Map();
                    for (let key of keys) {
                        let name = groups[key]["name"];
                        sortedResult.set(name, result[key]);
                    }
                    return sortedResult;
                } else {
                    // 合并所有分组
                    let merged = new Map();
                    for (let key of keys) {
                        for (let [k, v] of result[key]) {
                            merged.set(k, v);
                        }
                    }
                    return merged;
                }
            }

            let getFavoriteStatus = async (id) => {
                let res = await Network.get(`${this.apiUrl}/api/v3/comic2/${id}/query`, this.headers);
                if (res.status !== 200) {
                    throw `Invalid status code: ${res.status}`;
                }
                return JSON.parse(res.body).results.collect != null;
            }
            let reqId = await this.getReqID();
            let results = await Promise.all([
                Network.get(
                    `${this.apiUrl}/api/v3/comic2/${id}?in_mainland=true&request_id=${reqId}&platform=3`,
                    this.headers
                ),
                getFavoriteStatus.bind(this)(id)
            ])

            if (results[0].status !== 200) {
                throw `Invalid status code: ${results[0].status}`;
            }

            let data = JSON.parse(results[0].body).results;
            let comicData = data.comic;

            let title = comicData.name;
            let cover = comicData.cover;
            let authors = comicData.author.map(e => e.name);
            // author_path_word_dict长度限制为最大100
            if (Object.keys(this.author_path_word_dict).length > 100) {
                this.author_path_word_dict = {};
            }
            // 储存author对应的path_word
            comicData.author.forEach(e => (this.author_path_word_dict[e.name] = e.path_word));
            let tags = comicData.theme.map(e => e?.name).filter(name => name !== undefined && name !== null);
            let updateTime = comicData.datetime_updated ? comicData.datetime_updated : "";
            let description = comicData.brief;
            let chapters = await getChapters(id, data.groups);
            let status = comicData.status.display;

            return {
                title: title,
                cover: cover,
                description: description,
                tags: {
                    "作者": authors,
                    "更新": [updateTime],
                    "标签": tags,
                    "状态": [status],
                },
                chapters: chapters,
                isFavorite: results[1],
                subId: comicData.uuid
            }
        },
        loadEp: async (comicId, epId) => {
            // 章节加载前先限速 — 这是最容易被封的端点
            await this._rateLimit();

            let attempt = 0;
            const maxAttempts = 5;
            let res;
            let data;

            while (attempt < maxAttempts) {
                try {
                    let reqId = await this.getReqID();
                    res = await Network.get(
                        `${this.apiUrl}/api/v3/comic/${comicId}/chapter2/${epId}?in_mainland=true&request_id=${reqId}`,
                        {
                            ...this.headers
                        }
                    );

                    if (res.status === 210) {
                        // 210 indicates too frequent access, extract wait time
                        let waitTime = 40000; // Default wait time 40s
                        try {
                            let responseBody = JSON.parse(res.body);
                            if (
                                responseBody.message &&
                                responseBody.message.includes("Expected available in")
                            ) {
                                let match = responseBody.message.match(/(\d+)\s*seconds/);
                                if (match && match[1]) {
                                    waitTime = parseInt(match[1]) * 1000;
                                }
                            }
                        } catch (e) {
                            console.log(
                                "Unable to parse wait time, using default wait time 40s"
                            );
                        }
                        // 对等待时间加入 20% 随机抖动，避免多设备同步重试
                        let jitteredWait = CopyManga.jitter(waitTime, 0.2);
                        // 指数退避：每次重试比上次多等 50%
                        let backoffMultiplier = 1 + (attempt * 0.5);
                        let finalWait = Math.floor(jitteredWait * backoffMultiplier);

                        console.log(`Chapter${epId} access too frequent (attempt ${attempt + 1}/${maxAttempts}), waiting ${(finalWait / 1000).toFixed(1)}s (base: ${waitTime / 1000}s)`);
                        await new Promise((resolve) => setTimeout(resolve, finalWait));
                        throw "Retry";
                    }

                    if (res.status !== 200) {
                        throw `Invalid status code: ${res.status}`;
                    }

                    data = JSON.parse(res.body);
                    // console.log(data.results.chapter);
                    // Handle image link sorting
                    let imagesUrls = data.results.chapter.contents.map((e) => e.url);
                    let orders = data.results.chapter.words;

                    // Replace origin images urls to selected quality images urls
                    let hdImagesUrls = imagesUrls.map((url) =>
                        url.replace(/([./])c\d+x\.[a-zA-Z]+$/, `$1c${this.imageQuality}x.webp`)
                    )

                    let images = new Array(hdImagesUrls.length).fill(""); // Initialize an array with the same length as imagesUrls

                    // Arrange images according to orders
                    for (let i = 0; i < hdImagesUrls.length; i++) {
                        images[orders[i]] = hdImagesUrls[i];
                    }

                    return {
                        images: images,
                    };
                } catch (error) {
                    if (error !== "Retry") {
                        throw error;
                    }
                    attempt++;
                    if (attempt >= maxAttempts) {
                        throw error;
                    }
                }
            }
        },
        loadComments: async (comicId, subId, page, replyTo) => {
            await this._rateLimit();

            let url = `${this.apiUrl}/api/v3/comments?comic_id=${subId}&limit=20&offset=${(page - 1) * 20}`;
            if (replyTo) {
                url = url + `&reply_id=${replyTo}&_update=true`;
            }
            let res = await Network.get(
                url,
                this.headers,
            );

            if (res.status !== 200) {
                if (res.status === 210) {
                    throw "210：注冊用戶一天可以發5條評論"
                }
                throw `Invalid status code: ${res.status}`;
            }

            let data = JSON.parse(res.body);

            let total = data.results.total;

            return {
                comments: data.results.list.map(e => {
                    return {
                        userName: replyTo ? `${e.user_name}  👉  ${e.parent_user_name}` : e.user_name, // 拷贝的回复页并没有楼中楼（所有回复都在一个response中），但会显示谁回复了谁。所以加上👉显示。
                        avatar: e.user_avatar,
                        content: e.comment,
                        time: e.create_at,
                        replyCount: e.count,
                        id: e.id,
                    }
                }),
                maxPage: (total - (total % 20)) / 20 + 1,
            }
        },
        sendComment: async (comicId, subId, content, replyTo) => {
            let token = this.loadData("token");
            if (!token) {
                throw "未登录"
            }
            if (!replyTo) {
                replyTo = '';
            }
            let res = await Network.post(
                `${this.apiUrl}/api/v3/member/comment`,
                {
                    ...this.headers,
                    "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
                },
                `comic_id=${subId}&comment=${encodeURIComponent(content)}&reply_id=${replyTo}`,
            );

            if (res.status === 401) {
                error(`Login expired`);
                return;
            }

            if (res.status !== 200) {
                throw `Invalid status code: ${res.status}`;
            } else {
                return "ok"
            }
        },
        loadChapterComments: async (comicId, epId, page, replyTo) => {
            await this._rateLimit();

            let url = `${this.apiUrl}/api/v3/roasts?chapter_id=${epId}&limit=20&offset=${(page - 1) * 20}`;
            let res = await Network.get(
                url,
                this.headers,
            );

            if (res.status !== 200) {
                throw `Invalid status code: ${res.status}`;
            }

            let data = JSON.parse(res.body);

            let total = data.results.total;

            return {
                comments: data.results.list.map(e => {
                    return {
                        userName: e.user_name,
                        avatar: e.user_avatar,
                        content: e.comment,
                        time: e.create_at,
                        replyCount: null,
                        id: null,
                    }
                }),
                maxPage: (total - (total % 20)) / 20 + 1,
            }
        },
        sendChapterComment: async (comicId, epId, content, replyTo) => {
            let token = this.loadData("token");
            if (!token) {
                throw "未登录"
            }
            let res = await Network.post(
                `${this.apiUrl}/api/v3/member/roast`,
                {
                    ...this.headers,
                    "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
                },
                `chapter_id=${epId}&roast=${encodeURIComponent(content)}`,
            );

            if (res.status === 401) {
                throw `Login expired`;
            }

            if (res.status !== 200) {
                if (res.status === 210) {
                    throw `210:评论过于频繁或评论内容过短过长`;
                }
                throw `Invalid status code: ${res.status}`;
            } else {
                return "ok"
            }
        },
        onClickTag: (namespace, tag) => {
            if (namespace === "标签") {
                return {
                    // 'search' or 'category'
                    action: 'category',
                    keyword: `${tag}`,
                    // {string?} only for category action
                    param: null,
                }
            }
            if (namespace === "作者") {
                return {
                    // 'search' or 'category'
                    action: 'search',
                    keyword: `${namespace}:${tag}`,
                    // {string?} only for category action
                    param: null,
                }
            }
            throw "未支持此类Tag检索"
        }
    }

    settings = {
        favorites_ordering: {
            title: "收藏排序方式",
            type: "select",
            options: [
                {
                    value: '-datetime_updated',
                    text: '更新时间'
                },
                {
                    value: '-datetime_modifier',
                    text: '收藏时间'
                },
                {
                    value: '-datetime_browse',
                    text: '阅读时间'
                }
            ],
            default: '-datetime_updated',
        },
        region: {
            title: "CDN线路",
            type: "select",
            options: [
                {
                    value: "1",
                    text: '大陆线路'
                },
                {
                    value: "0",
                    text: '海外线路'
                },
            ],
            default: CopyManga.defaultCopyRegion,
        },
        image_quality: {
            title: "图片质量",
            type: "select",
            options: [
                {
                    value: '800',
                    text: '低 (800)'
                },
                {
                    value: '1200',
                    text: '中 (1200)'
                },
                {
                    value: '1500',
                    text: '高 (1500)'
                }
            ],
            default: CopyManga.defaultImageQuality,
        },
        search_api: {
            title: "搜索方式",
            type: "select",
            options: [
                {
                    value: 'baseAPI',
                    text: '基础API'
                },
                {
                    value: 'webAPI',
                    text: '网页端API'
                }
            ],
            default: 'baseAPI'
        },
        base_url: {
            title: "API地址",
            type: "input",
            validator: '^(?!:\\/\\/)(?=.{1,253})([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.)+[a-zA-Z]{2,}$',
            default: CopyManga.defaultApiUrl,
        },
        // ---- 高级反封禁设置 ----
        app_version: {
            title: "APP版本号（高级）",
            type: "input",
            validator: '^\\d+\\.\\d+\\.\\d+$',
            default: '3.0.9',
            description: "拷贝漫画APP版本号，APP更新后需同步修改。同时影响 User-Agent、referer、version 头。当前最新版：3.0.9（versionCode: 83, 2025.08.08构建）",
        },
        app_secret: {
            title: "HMAC密钥（高级）",
            type: "input",
            validator: null,
            default: "M2FmMDg1OTAzMTEwMzJlZmUwNjYwNTUwYTA1NjNhNTM=",
            description: "请求签名的 HMAC-SHA256 密钥（Base64 编码）。APP更新后可能更换，需从新版本APK中提取。",
        },
        app_umstring: {
            title: "友盟标识（高级）",
            type: "input",
            validator: null,
            default: "b4c89ca4104ea9a97750314d791520ac",
            description: "友盟统计 SDK 标识字符串。与APP版本绑定，更新APP版本时建议同步更新。",
        },
        clear_device_info: {
            title: "清除设备信息",
            type: "callback",
            buttonText: "点击清除设备信息",
            callback: () => {
                this.deleteData("_deviceinfo");
                this.deleteData("_device");
                this.deleteData("_pseudoid");
                // 同时清除 request_id 缓存，因为换了设备指纹
                this._reqIdCache = null;
                this._reqIdCacheTime = 0;
                // 清除请求时间戳记录
                this._requestTimestamps = [];
                this.refreshAppApi();
            }
        },
        // version: {
        //     title: "拷贝版本（重启APP生效）",
        //     type: "input",
        //     default: CopyManga.defaultCopyVersion,
        // },
        // platform: {
        //     title: "平台代号（重启APP生效）",
        //     type: "input",
        //     validator: '^\\d+(?:\\.\\d+)*$',
        //     default: CopyManga.defaultCopyPlatform,
        // },
    }

    /**
     * Check if the current app version is after the target version
     * @param target {string} target version
     * @returns {boolean} true if the current app version is after the target version
     */
    isAppVersionAfter(target) {
        let current = APP.version
        let targetArr = target.split('.')
        let currentArr = current.split('.')
        for (let i = 0; i < 3; i++) {
            if (parseInt(currentArr[i]) < parseInt(targetArr[i])) {
                return false
            }
        }
        return true
    }

    async refreshSearchApi() {
        // 尝试多个可能的域名，因为拷贝漫画会更换搜索页面域名
        const searchPageUrls = [
            "https://www.copy20.com/search",
            "https://www.copy3000.com/search",
            "https://www.copy202602.com/search",
        ];
        for (const url of searchPageUrls) {
            try {
                let res = await fetch(url, {
                    headers: {
                        "User-Agent": `COPY/${this.appVersion}`,
                        "Accept": "text/html,application/xhtml+xml",
                    }
                });
                if (res.status === 200) {
                    let text = await res.text();
                    // 兼容两种格式: const countApi = "..." 和 countApi = "..."
                    let match = text.match(/(?:const\s+)?countApi\s*=\s*"([^"]+)"/);
                    if (match && match[1]) {
                        CopyManga.searchApi = match[1];
                        return; // 成功获取，退出
                    }
                }
            } catch (e) {
                // 尝试下一个 URL
            }
        }
    }

    async refreshAppApi() {
        const url = "https://api.copy-manga.com/api/v3/system/network2?platform=3";
        try {
            const res = await fetch(url, { headers: this.headers });
            if (res.status === 200) {
                let data = await res.json();
                // api[0][0] 是当前可用的 API 域名
                let apiHost = data.results.api[0][0];
                if (apiHost && typeof apiHost === 'string' && apiHost.length > 0) {
                    this.settings.base_url = apiHost;
                }
            }
        } catch (e) {
            // 网络错误时保留现有 base_url 不变
        }
    }
}
