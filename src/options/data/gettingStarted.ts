/**
 * 「新手引导」这一页的正文。
 *
 * 为什么不塞进 locales/*.json：这是一份长文档（九节、上百条句子）。那两个语言包是给控件
 * 标签用的，把段落数组塞进去会把它变成没人读得下去的东西；而且这一页要表达结构
 * （有序步骤 / 要点 / 问答），JSON 表达不了。两种语言各写一份，不是互译关系 ——
 * 英文那份按英文的读法组织句子。取哪一份由 GuideView.vue 跟着 locale 走。
 *
 * ⚠️ 文案里「」包着的都是界面上真实存在的字。改之前回源码核一遍，别凭印象写：
 * 这页是新手看到的第一段说明，写错一个按钮名就等于把新人往错的地方指。
 */

export interface IGuideItem {
  /** 加粗前缀（「我的数据」这类条目名）；纯叙述的步骤可以不填 */
  title?: string;
  text: string;
}

export interface IGuideSection {
  id: string;
  title: string;
  /** 小节开头的一段话 */
  lead?: string;
  /** 有序步骤 */
  steps?: IGuideItem[];
  /** 无序要点 */
  points?: IGuideItem[];
  /** 问答 */
  faq?: { q: string; a: string }[];
}

export interface IGuideDoc {
  /** 页面大标题下面那句一句话介绍 */
  tagline: string;
  /** 目录条目的顺序 = 下面的章节顺序 */
  toc: string;
  sections: IGuideSection[];
}

export const guideZh: IGuideDoc = {
  tagline: "把几十个 PT 站收进一个界面：一次搜索问全站，结果直接推进你自己的下载器。",
  toc: "目录",
  sections: [
    {
      id: "what",
      title: "这个插件能干什么",
      lead: "PT 站的玩法是「同一个资源，几十个站各有一份」，而每个站的界面、地址、数据统计各写一套。这个插件把这些重复的部分合掉：一次搜索同时问所有站，结果并排比较；种子直接推给你的下载器，不用先存文件再手动添加；每个站的分享率、做种量、未读消息列成一张表。",
      points: [
        { title: "聚合搜索", text: "一个关键词同时问多个站（默认 8 个并发，可在「基础设置 → 搜索 → 同时搜索站点数」改），结果里站点、分类、大小、做种数、发布时间并排可比，点表头就能排序。" },
        { title: "一键推送", text: "结果行上点「发送到默认下载器」，种子就进了 qBittorrent / Transmission 等下载器；要选目录、打标签就用「发送到下载器」。" },
        { title: "数据一览", text: "「我的数据」把每个站的用户名、等级、分享率、做种量、魔力值、未读站内信排成一张表，不用挨个站登录去看。" },
        { title: "站页助手", text: "你在浏览器里打开某个站点页面时，页面右下角有个悬浮按钮，能就地搜索、批量推送、复制下载链接，不必切到扩展页。" },
        { title: "辅种与历史", text: "「辅种任务」把本地已有的文件重新挂回站点做种；「下载历史」记下每一次推送，失败了可以重下。" },
        { title: "备份", text: "站点、下载器、搜索方案这些配置能导出成 zip，也能推到你自己的 WebDAV / S3 / B2，可以设加密口令。" },
      ],
    },
    {
      id: "before",
      title: "开始之前，先备好三样",
      points: [
        { title: "一个能用的 PT 站账号", text: "并且要先在这个浏览器里登录过那个站。插件发出去的请求用的就是你浏览器里的登录状态，所以它不会弹登录框，也不需要你把站点密码交给它。" },
        { title: "一个开了远程界面的下载器", text: "以 qBittorrent 为例，要在它的「选项 → 下载器」里勾上「开机启动 Web 界面(QBittorrent)」并设一个用户名和密码；Transmission、Deluge、Aria2 同理，都要允许远程访问。下载器和浏览器在同一台机器上最容易先跑通。" },
        { title: "少数站点的额外凭据", text: "大部分站点加进来就能用；有的站会额外要你填 passkey、UID 或 API 令牌，这些值在站点自己的个人设置页里查得到。添加对话框里那颗绿色的「帮助」按钮会带你去配置说明。" },
      ],
    },
    {
      id: "add-site",
      title: "第一步：添加站点",
      steps: [
        { text: "左侧菜单点「站点管理」，再点工具条上的「增加」。" },
        { text: "先选站点：输入框里可以直接打关键词，内置的站点定义都能搜到。选中后点「下一步」。列表默认不显示已经死亡的站点，想看可以打开弹层底部的「展示已死亡站点」。" },
        { text: "再填配置。四项基本要动：「站点名称」（自己认得出就行）、「优先级」（一个数字，决定搜索时先问谁，默认 100）、「网站链接」（从候选里选，或者用「自定义站点域名」自己填，必须是 http/https 开头）；如果这个站要求凭据，「站点设置」那一栏会多出 passkey / 用户名 / 令牌之类的字段，不填「完成」不会亮。" },
        { text: "其余项目先留着默认值就能跑：「时区」、「下载链接后缀」、「请求超时」（默认 30 秒）、「下载间隔」、「上传速度」，以及「分类映射」（后面讲）。填完点右下角「完成」保存。" },
        { text: "想改就回到列表，点行上的铅笔图标进「编辑站点配置」。那一行还有几个开关：「已离线」（打开后这个站不再被请求）、「允许搜索」、「获取个人信息」；「搜索入口」用来决定这个站走哪几个搜索分类。" },
        { text: "验证：去「我的数据」点右上角「刷新数据」。这个站的等级、数据量读出来了，就说明配置通了。读不出来的行会挂「解析错误！」或「需要登录！」这样的红标，多半是浏览器里的登录掉了 —— 回浏览器重新登录那个站，再刷一次。" },
      ],
    },
    {
      id: "downloader",
      title: "第二步：配置下载器",
      steps: [
        { text: "左侧菜单点「下载器」，工具条上点「增加」。" },
        { text: "第一步选服务器类型（支持搜索），目前有 Aria2、Deluge、Flood、Transmission、qBittorrent、ruTorrent、synologyDownloadStation、uTorrent 这几种。选 qBittorrent 时下面会出现一段说明和版本要求（只支持 v4.1 以上），看完点「下一步」。" },
        { text: "第二步填三项：「服务器名称」自己起；「服务器地址」要带端口，例如 http://192.168.1.1:5000/（默认给的是 http://localhost:9091/）；「用户名」「密码」就是你在下载器 Web 界面里设的那一对。" },
        { text: "点「检查连接性」。通了会提示「连接成功，你可以顺利进行下一步。」，不通提示「连接失败！请检查填写的信息或者你的远程服务器。」后者先在浏览器里直接打开那个地址，能打开再回来核对端口和防火墙。" },
        { text: "注意：qBittorrent 第一次连接成功之后会复用会话，此时即使密码填错也照样提示成功。所以别把「连接成功」当成密码正确的证据 —— 真下载一次才算。" },
        { text: "要固定保存目录、默认打标签、或者添加时先暂停，展开「高级设置」。只配了一个下载器时它会自动成为默认下载器，搜索结果里那颗「发送到默认下载器」就是发给它。" },
      ],
    },
    {
      id: "search",
      title: "第三步：搜索并下载",
      steps: [
        { text: "左侧菜单点「搜索」。顶部第一个框是作用域，默认写着「默认搜索方案」，下面一行是〈全部站点〉—— 意思是这次会问所有你添加过、并且允许搜索的站。" },
        { text: "只想问几个站就点开作用域，在「站点」那一栏里勾，底部会显示「已选 N 个站点」；全取消勾选就又回到默认方案。结果区上方那一排站点 chip 是同一件事的快捷入口，点「全部站点」即清除单站筛选。" },
        { text: "在关键词框里输入要找的东西，回车或点右边的「搜索」。上面的状态条会先显示「搜索中…」，出首批结果后变成「搜索方案 …，关键词 …，已接收 N 条结果，搜索仍在进行……」，全部跑完显示「共 N 条结果，耗时：X 秒。」" },
        { text: "结果表点表头可排序；工具条上的漏斗是过滤框，可以把标题里带某些词的行筛掉；方块那枚按钮把这一批结果存成「搜索快照」，之后在同一页点工具条上的「搜索快照」按钮回看。搜索中想停下来，用状态行里的「暂停搜索队列」「取消当前等待的搜索」。" },
        { text: "下载：行末「发送到默认下载器」一键推走；想挑下载器或选目录就点「发送到下载器」。这个对话框默认是快速列表（一行一个下载器，点一下直接发送），要更多选项点行尾的 ⋯，或者点对话框左下角那个方框图标切到完整表单 —— 里面能选保存路径、种子标签，以及「添加时默认暂停」。" },
        { text: "不想经过下载器、只要种子文件本身，用「复制下载链接」或「下载种子文件到本地」。" },
      ],
    },
    {
      id: "helper",
      title: "在站点页面上直接用",
      lead: "打开某个已添加站点的具体页面时，页面右下角会有个悬浮按钮，点开展开这几个动作。",
      points: [
        { title: "快捷搜索", text: "拿当前页面的标题（或你输入的关键词）直接搜别的站，不用切到扩展页。" },
        { title: "推送到默认下载器 / 推送到...", text: "把当前页这个种子推走；带省略号的那颗会让你选下载器。" },
        { title: "复制链接", text: "复制这条种子的下载链接。" },
        { title: "高级列表", text: "在站点的列表页上批量挑种子（勾选未下载过、勾选上传行），再一次性推送。" },
        { text: "这套东西归「基础设置 → 在站点网页上 → 启用站点页面助手」管，默认是开的；看不到按钮就先回这里确认开关。" },
      ],
    },
    {
      id: "more",
      title: "之后你还能做什么",
      points: [
        { title: "我的数据", text: "所有站的账号数据一表看全，含未读站内信的红数字 —— 点那个数字可以在扩展里直接读信。同一页还有「统计图表」和「时间线」两个二级页，看数据随时间的变化。" },
        { title: "我的下载器", text: "直接看下载器里的种子：暂停、开始、删除、改标签、调速，不用打开下载器网页。" },
        { title: "搜索快照", text: "把某一次搜索结果存下来，之后回看或者再推送一遍。" },
        { title: "下载历史", text: "每一次推送的记录，含失败原因，可以重新下载。" },
        { title: "辅种任务", text: "本地已经有文件、想在别的站重新做种时用。任务从搜索页的「辅种检测」生成，这一页负责跑和记状态。" },
        { title: "媒体库 / 媒体服务器", text: "先在「媒体服务器」里填上 Emby / Jellyfin / Plex / fnOS 的地址和密钥，再在「媒体库」里直接翻库、搜片。" },
        { title: "数据备份", text: "本地导出 / 本地导入 zip，或者推到你配置的 WebDAV / S3 / B2 服务器；自动备份的间隔在左侧「数据备份」那一页设，备份包的加密口令在「基础设置 → 备份与数据迁移」。" },
        { title: "基础设置", text: "九节，按用得多不多分三档：「天天用得上」是搜索、下载与推送、在站点网页上；「按需调整」是账号与流量、外观与表格、百科与评分信息；「一次配好」是备份与数据迁移、检查更新、高级与诊断。日常要动的只有「搜索 → 同时搜索站点数」和「在站点网页上」那几颗开关。" },
        { title: "运行日志", text: "插件自己的日志表。哪个请求失败、为什么失败，先来这里看，比猜快。" },
      ],
    },
    {
      id: "faq",
      title: "常见问题",
      faq: [
        { q: "点搜索提示「请至少添加一个站点进行搜索」。", a: "站点还没加，或者加了但「允许搜索」都被关了。回「站点管理」添加站点，并确认那一行的「允许搜索」是开着的。" },
        { q: "某个站的结果栏挂着「需要登录！」或「CloudFlare 错误！」。", a: "浏览器里那个站的登录掉了。在浏览器里正常打开站点、重新登录一次（CloudFlare 那个可能要你过一次人机验证），再回搜索页点「重新搜索失败的方案」。" },
        { q: "整张结果表是空的，但状态条说共 0 条结果。", a: "两件事最常见：关键词太长（PT 站大多按分词匹配，先试片名本身）；或者作用域里勾的站这个分类根本没有你要的东西。把作用域放回「默认搜索方案」再搜一次。" },
        { q: "「发送到默认下载器」这颗按钮不见了。", a: "你还没设默认下载器。去「下载器」页把某一个设为默认，或者改用旁边的「发送到下载器」手动选。" },
        { q: "推送失败，但「检查连接性」是成功的。", a: "连接性检查只证明地址和登录通，不代表这个目录能写。换一个保存路径试试，或者去下载器网页上手动加一次看它报什么。qBittorrent 还要留意密码填错时它也会报成功。" },
        { q: "站内信的红数字和站点网页上的未读数不一样。", a: "红数字 = 站点报告的未读数减去你在扩展里读过的条数。扩展不会替你把站点上的信标成已读（那要往你的站点发写操作），所以站上的未读仍要你在站上点掉。" },
        { q: "搜索结果里「分类」这一列为什么都变成几个固定词了？", a: "同一种内容各站叫法不同（Movies / 电影 / Movies(电影) 是一家），这一列把它们折成了统一类别，鼠标停在上面能看到该站原样的写法。折错了就在「站点管理 → 编辑站点配置 → 分类映射」里按站纠正。" },
        { q: "想一次多搜几个站。", a: "「基础设置 → 搜索 → 同时搜索站点数」，1 到 20，默认 8。调大更快，但站点那边可能限流。" },
      ],
    },
    {
      id: "privacy",
      title: "数据与隐私",
      points: [
        { title: "配置存在本地", text: "你填的站点凭据、下载器地址和账号密码，都存在这个浏览器给扩展的本地存储里，插件不会把它们发给任何第三方。" },
        { title: "请求只发往你填的地方", text: "站点请求发往你添加的那些站；下载器、媒体服务器、备份服务器只发你自己填的地址。没配备份服务器就不会往外传。" },
        { title: "有一处要说清", text: "查影片/剧集的社交信息时，对少数支持 PtGen 的站点，扩展会先向公开的 PtGen 端点（默认是 GitHub Pages / OurHelp 的公共地址）取一次，取不到再回落到豆瓣、Bangumi、AniDB 这些站。不想用就在「基础设置 → 百科与评分信息」里关掉「优先使用 PTGen 获取影片信息」，或者把端点换成你自己的。" },
        { title: "登录状态用的是浏览器 cookie", text: "扩展按站点地址读取它需要的那几枚 cookie（比如遇到 CloudFlare 时临时写一枚、用完就删），不会把你的整份 cookie 罐导出或上传。" },
      ],
    },
  ],
};

export const guideEn: IGuideDoc = {
  tagline: "Dozens of PT sites in one interface: search them all at once, push results straight into your own downloader.",
  toc: "Contents",
  sections: [
    {
      id: "what",
      title: "What this extension does",
      lead: "The way PT sites work is that one release exists on dozens of sites, each with its own layout, URL and statistics. This extension removes the repetition: one search asks every site at once, results line up side by side, torrents go straight to your downloader, and every account's ratio, seeding and unread mail sit in one table.",
      points: [
        { title: "Aggregated search", text: "One keyword hits several sites in parallel (8 at a time by default — Basic Settings → Search → Sites searched concurrently). Site, category, size, seeders and publish date are comparable in one row, and every column header sorts." },
        { title: "One-click push", text: "Send to default downloader on the row puts the torrent into qBittorrent, Transmission and friends; Send to downloader lets you pick the path and tags." },
        { title: "Accounts at a glance", text: "My Data lists username, class, ratio, seeding, bonus points and unread messages for every site, so you don't log in site by site." },
        { title: "In-page helper", text: "When you open a site page in the browser, a floating button appears in its corner: search from that page, push in bulk, copy the download link — without leaving the site." },
        { title: "Reseed and history", text: "Reseed Task re-attaches files you already have; Download History records every push and lets you retry a failed one." },
        { title: "Backup", text: "Sites, downloaders and search plans export to a zip, or go to your own WebDAV / S3 / B2 with an optional passphrase." },
      ],
    },
    {
      id: "before",
      title: "Three things to have ready",
      points: [
        { title: "A working PT account", text: "and make sure you have logged in to that site in this browser. The extension rides on your browser session, so it never asks for a password and never shows a login form." },
        { title: "A downloader with its remote interface on", text: "In qBittorrent that means ticking Start Web server at startup under Options → Downloads, plus a username and password. Transmission, Deluge and Aria2 work the same way — remote access has to be allowed. Same machine as the browser is the easiest first run." },
        { title: "Extra credentials for a few sites", text: "Most sites work as soon as they are added; some also want a passkey, UID or API token, which you find on the site's own settings page. The green Help button in the add dialog links to the configuration guide." },
      ],
    },
    {
      id: "add-site",
      title: "Step 1: add a site",
      steps: [
        { text: "Open Sites in the left menu, then press Add in the toolbar." },
        { text: "Pick the site — the box searches through the built-in site definitions. Press Next. Long-dead sites stay hidden until you tick Show dead sites at the bottom." },
        { text: "Fill in the settings. Four things matter: Site Name (anything you recognise), Priority (a number deciding who gets asked first, default 100), URL (choose one, or Custom site url — must start with http/https); and if the site needs credentials, a Site Settings block appears with passkey / username / token fields. Until those are filled, Complete stays disabled." },
        { text: "Everything else works at its default: Timezone, Download Link Suffix, Request Timeout (30 seconds by default), Download Interval, Upload Speed and Category mapping (covered later). Press Complete to save." },
        { text: "To change it later, use the pencil icon on the row — Edit Site Config. That row also carries the switches: Offline (stops all requests to the site), Allow search, Allow user info; Search entries choose which search categories the site uses." },
        { text: "Check your work: go to My Data and press Refresh data. If the site's class and traffic came back, the setup is right. A row marked Parse error! or Login required! usually means your browser session on that site expired — log in there again and refresh." },
      ],
    },
    {
      id: "downloader",
      title: "Step 2: configure a downloader",
      steps: [
        { text: "Open Downloader in the left menu and press Add." },
        { text: "Choose the server type (the list is searchable): Aria2, Deluge, Flood, Transmission, qBittorrent, ruTorrent, synologyDownloadStation and uTorrent are supported. Picking qBittorrent shows a note with its version requirement (v4.1 or newer). Press Next." },
        { text: "Then fill three fields: Server Name (your own label), Server Address (include the port, e.g. http://192.168.1.1:5000/ — it defaults to http://localhost:9091/), and the Username / Password you set in the downloader's web interface." },
        { text: "Press Check Connect. Success reads Connection succeeded, you can continue.; failure reads Connection failed — check what you typed or your remote server. For the latter, open that address in the browser first: if it doesn't open there, it won't open from here." },
        { text: "One caveat: after qBittorrent connects once, the session is reused, so a wrong password still reports success. Don't treat Connection succeeded as proof the password is right — send one real torrent to find out." },
        { text: "Need a fixed save path, default labels or paused-on-add? Open Advanced Settings. If this is your only downloader it becomes the default, which is what Send to default downloader on the search results uses." },
      ],
    },
    {
      id: "search",
      title: "Step 3: search and download",
      steps: [
        { text: "Open Search. The first box at the top is the scope; it says Default search plan with 〈All Sites〉 underneath, meaning every site you added and allowed gets asked." },
        { text: "To ask only a few sites, expand the scope and tick them under Sites — the footer shows N site(s) selected. Unticking everything returns to the default plan. The row of site chips above the results is the same control, and All Sites there clears a single-site filter." },
        { text: "Type a keyword and press Enter or Search. The status line shows Searching... first, then the plan, the keyword and how many results arrived while the search is still running, and finally N results in X seconds." },
        { text: "Click column headers to sort; the funnel button opens a filter box that drops rows by title; the snapshot button saves this result set so you can revisit it from the Search Snapshots button on the same toolbar. To stop mid-flight use Pause search queue or Cancel pending searches." },
        { text: "To download: Send to default downloader pushes it in one click, Send to downloader lets you choose. That dialog opens as a quick list (one downloader per row, click to send). For more, use the ⋯ at the end of the row, or the small square button in the dialog's lower-left corner to switch to the full form with save path, tags and Add in paused state." },
        { text: "Just want the torrent file itself? Copy download link or Download torrent file to local." },
      ],
    },
    {
      id: "helper",
      title: "Working from the site page itself",
      lead: "On a site page you added, a floating button sits in the lower-right corner with these actions.",
      points: [
        { title: "Quick search", text: "Search other sites using the current page's title, or a keyword you type, without leaving the page." },
        { title: "Push to default downloader / Push to...", text: "Send this torrent away; the one with the ellipsis lets you pick the downloader." },
        { title: "Copy link", text: "Copy this torrent's download link." },
        { title: "Advanced list", text: "Pick torrents in bulk on a site's listing page (skip what you already downloaded, tick the upload rows) and push them all at once." },
        { text: "All of this is governed by Basic Settings → On site pages → Enable the site page helper, which is on by default. If you don't see the button, check that switch first." },
      ],
    },
    {
      id: "more",
      title: "What else is in the menu",
      points: [
        { title: "My Data", text: "Every account in one table, including the red unread-mail badge — click it to read the messages inside the extension. Statistics and Timeline are second-level pages on the same table." },
        { title: "My Clients", text: "See what's inside your downloaders and pause, resume, delete, relabel or change speed there, without opening the downloader's own web UI." },
        { title: "Search Snapshot", text: "Saved result sets you can revisit or push again later." },
        { title: "Download History", text: "A record of every push, with the failure reason, and a way to retry." },
        { title: "Reseed Task", text: "For files you already have on disk that you want to seed on another site; tasks come from Reseed check on the search page." },
        { title: "Media Library / Media Server", text: "Fill in Emby / Jellyfin / Plex / fnOS under Media Server, then browse and search them from Media Library." },
        { title: "Backup", text: "Export and import a local zip, or push to your WebDAV / S3 / B2 server; the automatic backup interval is set on the 'Backup' page in the sidebar, while the passphrase for a backup file lives under Basic Settings → Backup & migration." },
        { title: "Basic Settings", text: "Nine sections in three tiers, by how often you'd touch them. 'Day to day': Search, Download & send, On site pages. 'When needed': Accounts & traffic, Appearance & tables, Metadata & ratings. 'Set once': Backup & migration, Updates, Advanced & diagnostics. Day to day you'll only touch Sites searched concurrently and a few of the On site pages switches." },
        { title: "Runtime Log", text: "The extension's own log. When a request fails, read it here before guessing." },
      ],
    },
    {
      id: "faq",
      title: "Questions people actually hit",
      faq: [
        { q: "It says I need to add at least one site before searching.", a: "No site added yet, or every site has Allow search switched off. Go to Sites, add one, and check that switch on its row." },
        { q: "A site's row shows Login required! or a Cloudflare error.", a: "Your browser session on that site expired. Open the site in the browser, log in (with Cloudflare you may have to pass the check), then use Retry failed plans on the search page." },
        { q: "The result table is empty and the status line says 0 results.", a: "Two usual causes: the keyword is too long (sites match tokens, so try just the title), or the sites in scope genuinely don't carry it. Put the scope back to Default search plan and try again." },
        { q: "There is no Send to default downloader button.", a: "You haven't set a default downloader. Mark one under Downloader, or use Send to downloader and pick each time." },
        { q: "Check Connect passes but pushing fails.", a: "The check only proves the address and login work — it doesn't prove the folder is writable. Try another save path, or add the torrent once in the downloader's own UI and read what it complains about. On qBittorrent, remember a wrong password still reports success." },
        { q: "The unread badge doesn't match the site.", a: "The badge is the site's unread count minus what you've already opened here. The extension never marks mail as read on the site (that would be a write request to your account), so the site's own counter only moves when you read there." },
        { q: "Why did the Category column turn into a handful of fixed words?", a: "The same content is named differently per site (Movies / 电影 / Movies(电影) are one thing), so the column folds them into one category and hovering shows the site's own wording. If a site gets folded wrong, correct it per site under Sites → Edit Site Config → Category mapping." },
        { q: "Can I search more sites at once?", a: "Basic Settings → Search → Sites searched concurrently, 1 to 20, default 8. Higher is faster but sites may rate-limit you." },
      ],
    },
    {
      id: "privacy",
      title: "Data and privacy",
      points: [
        { title: "Configuration stays local", text: "Site credentials, downloader addresses and passwords live in this browser's local storage for the extension. Nothing is forwarded to a third party." },
        { title: "Requests go where you pointed", text: "Site requests go to the sites you added; downloader, media server and backup requests go to addresses you typed in. No backup server configured means nothing leaves." },
        { title: "One thing to know", text: "When looking up movie/series metadata, a few sites supported by PtGen are resolved against public PtGen endpoints first (GitHub Pages / OurHelp by default) before falling back to Douban, Bangumi or AniDB. Turn it off with Basic Settings → Metadata & ratings → Prefer PTGen for movie information, or point it at your own server." },
        { title: "Login rides on browser cookies", text: "The extension reads only the cookies a given site needs (and writes a temporary one when Cloudflare demands it, deleting it afterwards). It never exports or uploads your whole cookie jar." },
      ],
    },
  ],
};
