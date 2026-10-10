/**
 * 「辅种怎么用」这份说明的正文。
 *
 * 为什么不塞进 locales/*.json：这是一份带结构的长文档（有序步骤 / 要点 / 问答），
 * 语言包那两个文件是给控件标签用的，把段落数组塞进去会把它变成没人读得下去的东西。
 * 两种语言各写一份，不是互译关系 —— 英文那份按英文的读法组织句子。
 * 取哪一份由 KeepUploadUsageDialog.vue 跟着 locale 走（同 src/options/data/gettingStarted.ts 的套路）。
 *
 * ⚠️ 文案里「」包着的都是界面上真实存在的字，每条都回源码核过（辅种检测对话框、
 * 辅种任务页的操作列、指纹判定那几层）。改之前先回源码看一遍，别凭印象写 ——
 * 写错一个按钮名就等于把人往错的地方指。
 */

export interface IUsagePoint {
  /** 加粗前缀（按钮名 / 术语）；纯叙述的要点可以不填 */
  title?: string;
  text: string;
}

export interface IUsageSection {
  id: string;
  title: string;
  /** 小节开头的一段话 */
  lead?: string;
  /** 有序步骤 */
  steps?: string[];
  /** 无序要点 */
  points?: IUsagePoint[];
}

export interface IUsageDoc {
  /** 标题下面那一句：辅种到底是干什么 */
  intro: string;
  sections: IUsageSection[];
}

export const usageZh: IUsageDoc = {
  intro:
    "辅种：同一份内容在好几个站点各有一个种子条目，你只想把数据下载一次，再让下载器拿已经有的那份去给其他站点做种。「辅种任务」页管的就是这种「一份数据对多个条目」的任务。",
  sections: [
    {
      id: "create",
      title: "一、任务在「搜索结果」页创建，不在「辅种任务」页",
      steps: [
        "去「搜索结果」页搜一遍，把同一部内容在几个站点上的条目用行首的复选框勾上。只勾一条也行 —— 那种情形是内容早就下完了，只要再挂上这一站。",
        "点结果列表上方那一排按钮里的分叉图标（悬停显示「辅种检测」），打开「辅种检测」对话框。",
        "勾了多条时，对话框里排在第一条的就是「基准种子」：它是你本地已经有了、或者打算先下好的那一条；其余都是「其他种子」。想换一条当基准，点它那行右边的「用它当基准」（向上箭头），它会被挪到第一位，其余条目跟着按新基准重判。",
        "基准也可以取下载器里已有的一条：对话框上方那一栏「基准种子（下载器里已有的那一条）」（勾多条时写的是「基准种子（也可以指定下载器里已有的一条）」）会拿列表第一条的文件清单去下载器里找，文件清单一致的那条替你选好；只按标题+大小对上的不算证据，只会列出来等你自己挑。指定了下载器那条之后，列表里全部条目都变成「要辅种的条目」，基准不再占其中一条。",
        "拿不准该选哪一条时，列表上方那排「推荐基准」给两条：一颗是这一批里做种人数最多的那条，一颗是免费下载的那批里做种最多的那条 —— 基准那一条是要真下一遍的，所以「还热着」和「不花下载量」是挑它的两条理由。点一下那颗就把那一条挪成基准；两条指的是同一条时只出现一颗，一批里没有免费的时也只剩一颗，一条做种数都拿不出来时那一整行都不出现。表格里新加的「做种」「下载」两列就是这两组推荐吃的数，都能点表头排序（排完序「基准」标签仍跟着真正那条，不会跟到第一行）。",
        "选下载器、填保存路径（标签可选），点「创建任务」。要让它点得动：基准取列表第一条时，要验证通过并纳入的条目超过 1 条（基准 + 至少一条其他）并且下载器已经选上；基准取下载器那条时，只要有一条验证通过就行 —— 但只按标题+大小对上的基准不算证据，那一条的状态会写「算不出文件清单，需要你确认后手动加入」，点它右边的加号确认之后才点得动。",
      ],
    },
    {
      id: "verify",
      title: "二、它凭什么判定「这几条是同一份内容」",
      lead: "在「辅种检测」对话框里，助手会逐条把种子文件下载下来比对指纹，状态那一列会写明这次是靠哪一层判出来的，越靠前的层越硬：",
      points: [
        { title: "同一 infohash", text: "两条本来就是同一个种子，最确定。" },
        { title: "piece 抽样一致", text: "抽样比对种子内部的数据块哈希。" },
        { title: "文件清单指纹一致", text: "按文件清单比对。" },
        { title: "文件逐条比对", text: "退回最粗的一层。" },
      ],
    },
    {
      id: "local",
      title: "三、本地已有的那些，它不替你决定",
      points: [
        { text: "在「辅种检测」对话框里选上下载器之后，它会读一份本地种子指纹索引，把「本地已有」「同站已挂」「疑似：仅标题+大小匹配」这几类标出来。" },
        { text: "默认只是标出来，不会悄悄把你本地已经有的那条从任务里拿掉 —— 要排除得自己勾「排除本地已有的」。基准取的是下载器里那条时这颗开关会出现不了：那种任务里每一条都「本地已有」，那正是它成立的前提，照原样排除会把列表清空。" },
        { text: "「重建本地指纹索引」那颗按钮就在提示文字右边。有些下载器不支持导出文件清单，对话框上方会直接写明「该下载器不支持导出文件清单，只能按标题+大小粗筛」，这时候只能按标题+大小粗筛。" },
      ],
    },
    {
      id: "buttons",
      title: "四、「辅种任务」页每颗按钮做什么",
      points: [
        {
          title: "设为基准种子",
          text: "行首那个加号展开后能看到这一任务里的每一条子种子，某条右边那颗「↑」把它挪到第一位，之后「发送基准种子」发的就是它。",
        },
        { title: "发送基准种子", text: "只把排第一的那一条推进下载器，用来先把内容真正下下来。" },
        {
          title: "发送其他种子",
          text: "把除第一条以外的全部推过去 —— 这一步才是辅种。一次推多条会先弹确认。",
        },
        { title: "发送所有种子", text: "全部推，含基准那一条。" },
        {
          title: "基准在下载器里的那种任务",
          text: "从「只勾一条」那条路创建的任务，数据用的是下载器里已有的另一条种子：标题下面多出一行「基准种子（下载器里）：」写明挂在谁身上，行首展开后只有那一条要挂上去的本站条目。这种任务里「发送基准种子」「发送其他种子」「设为基准种子」都不出现，只留一颗「发送这一条去辅种」。",
        },
        { title: "复制下载链接", text: "把这一任务里所有种子的下载链接按行复制到剪贴板，方便你自己粘到别处。" },
        {
          title: "删除 / 清空全部",
          text: "删的是助手自己记的这条任务，不会去动你下载器里正在跑的东西。",
        },
      ],
    },
    {
      id: "send",
      title: "五、发送时还会发生什么",
      points: [
        { text: "一添加就开始下载、还是先暂停，跟着该下载器自己的「发送种子时自动开始下载」开关走（在下载器设置里），「辅种任务」页不另做一个开关。" },
        { text: "发出去的每一条都带着「跳过校验」：数据本来就在盘上，那一遍全量哈希只是把几十 G 再读一遍。该不该跳在创建任务那一步已经判过了 —— 只有文件清单和内容对得上的才会自动选中，对不上时要你自己确认。不认这个选项的下载器（qBittorrent 以外的）会照常校验。" },
        { text: "因为跳过了校验，「数据其实不在」不会以报错的形式出现，只会以状态的形式：所以发出去约 18 秒后，这一页会自己去下载器那边回查一次，结果写在「做种状态」那一列（把鼠标放上去能逐条看到，含客户端原样的状态串）。也能随时点工具条上的「回查做种状态」再查一遍。" },
        { text: "回查判出来「没有正常做种」的那些（文件缺失、客户端报错、或者变成了正在下载），这一页会立刻替你把那一条暂停，并弹一条红色提示说清有几条、为什么。查不到、或还在校验中的不算失败，不会动它 —— qBittorrent 那边那份列表 15 秒才刷一次，刚发出去查不到是正常中间态。" },
        { text: "保存路径和标签里可以放占位符，发送时逐条替换：$torrent.title$、$torrent.subTitle$、$torrent.category$、$torrent.site$、$torrent.siteName$、$date:YYYY$、$date:MM$、$date:DD$。" },
        { text: "标题下面那行「保存路径：某下载器 -> 某路径」就是这个任务会落到哪里；没填的话那里写「默认路径」。" },
      ],
    },
    {
      id: "auto",
      title: "六、想让任务自己往下走：「自动辅种」开关",
      lead:
        "创建辅种任务那一屏最右边、那颗「创建任务」按钮旁边有一颗「自动辅种」开关，默认开着。开着的时候不用你守着点按钮 —— 扩展每隔 1 分钟自己去看一眼那台下载器：",
      points: [
        { title: "第一步", text: "基准那条不在下载器里，就先把基准发过去，而且这一条**不**跳过校验 —— 它是要真的把内容下下来的那一条。" },
        { title: "第二步", text: "每分钟查基准下完没有，认的是下载器自己报的「已完成」，不是「状态看着像做种」。一开始基准就已经下完（或者基准选的本来就是下载器里那条在做种的）就直接进第三步。" },
        { title: "第三步", text: "基准下完，把其余几条一起发过去，这几条跳过校验 —— 内容在建任务那一步已经比过文件清单。" },
        { title: "之后", text: "持续盯这一任务里每一条的做种状态。判成「没有正常做种」的那几条（文件缺失、客户端报错、或者变成了正在下载）会立刻被暂停，并弹一条系统通知说清有几条、进哪一页看。" },
        { text: "「做种状态」那一列显示的就是它走到哪一步了（已发基准 / 基准在下 x% / 基准已下完 / 辅种中 n/m / 辅种完成 / 有 N 条异常），不用你手动点「回查做种状态」也有数。" },
        { text: "开关只管你这一次建的那条任务：以前建的任务不会因为你升级就突然开始自动发种子。关掉它也不会动已经发出去的种子，更不会替你暂停它们。" },
        { text: "下载器连不上时那一轮什么都不做 —— 「没查到」不会被当成「不在下载器里」，于是既不会重发也不会暂停。基准连着 3 次都进不了下载器的列表就不再自动重试，原因写在「运行日志」里。" },
      ],
    },
    {
      id: "risk",
      title: "七、风险与责任边界",
      lead: "「辅种任务」页底部那条「警告：」的三条就是这功能的责任边界，动手前先读那三条。这里再补几条排查用的：",
      points: [
        { text: "辅种前确认下载器没有开着「自动开始下载」这一类选项（有的话先关掉）。让下载器先暂停、你确认文件真的都在位之后再开始，是最稳的。" },
        { text: "助手只对种子文件做简单验证，不保证辅种成功；因辅种失败造成的爆仓由用户自行负责，那条警告里写明了这两句。" },
        { text: "qBittorrent 有时只回一个 Fails. 不给原因。这种情况下提示会让你去检查：是不是已经有同一个种子在里面、保存路径或分类是否有效，并翻 qBittorrent 自己的日志。" },
      ],
    },
  ],
};

export const usageEn: IUsageDoc = {
  intro:
    "Reseeding: the same release often exists as a separate torrent entry on several sites, but you only want to download the data once and then let your downloader seed that one copy for all of them. The 'Reseed Tasks' page manages those 'one copy, several entries' tasks.",
  sections: [
    {
      id: "create",
      title: "1. Tasks are created on the 'Search Results' page, not on 'Reseed Tasks'",
      steps: [
        "Go to 'Search Results', run a search, and tick the checkboxes beside the entries that are the same content on different sites. Ticking just one works too - that is the case where the data finished downloading long ago and you only need to attach this one site.",
        "Click the branch icon in the heading row above the result list (its tooltip reads 'Reseed Check') to open the 'Reseed Verification' dialog.",
        "With several entries ticked, the one listed first is the 'Base Torrent': the one you already have, or the one you intend to download first. Everything else sits under 'Other Torrents'. To make a different entry the base, press 'Use this as the base' (the up arrow) beside it - it moves to first place and every other entry is re-judged against it.",
        "The base can also be a torrent your downloader already has. The 'Base torrent (an entry your downloader already has)' row at the top (with several entries it reads 'Base torrent (optionally pick one your downloader already has)') takes the first entry's file list and looks for the same data inside the downloader: an entry whose file list matches is selected for you. A match by title and size alone is not evidence - those are only listed for you to pick from. Once a downloader entry is the base, every row in the list becomes an 'Entries to reseed' row; the base is no longer one of them.",
        "When you are not sure which one to make the base, the 'Suggested base' row above the list offers two: the entry with the most seeders in this batch, and the one with the most seeders among the free ones. The base is a torrent you really do download once, so 'still alive' and 'costs no download quota' are the two reasons to pick it. Pressing one makes that entry the base. Only one button shows when both criteria point at the same entry, or when nothing in the batch is free, and the whole row disappears when no entry reports a seeder count at all. The new 'Seeders' and 'Leechers' columns are exactly what those suggestions read, and both are sortable by clicking the header (the 'Base Torrent' tag stays on the real base after sorting - it does not follow the first rendered row).",
        "Pick a downloader, set the save path (label optional), then press 'Create Task'. It becomes pressable when more than 1 verified entry is included (the base plus at least one other) and a downloader is selected. With a downloader entry as the base, one verified entry is enough - but an entry that only matched by title and size is not evidence: its status reads 'No file list to compare - confirm it yourself and add it', and pressing the plus beside it is what unlocks 'Create Task'.",
      ],
    },
    {
      id: "verify",
      title: "2. How it decides these entries are the same content",
      lead: "Inside the 'Reseed Verification' dialog it downloads each torrent file and compares fingerprints. The status line names the layer that decided it, strongest first:",
      points: [
        { title: "same infoHash", text: "Both entries are literally the same torrent. Certain." },
        { title: "piece sample matched", text: "Compares a sample of the piece hashes inside the torrent." },
        { title: "file list fingerprint matched", text: "Compares the file listing." },
        { title: "file-by-file comparison", text: "Falls back to the coarsest check." },
      ],
    },
    {
      id: "local",
      title: "3. What you already have is flagged, not decided for you",
      points: [
        { text: "In the 'Reseed Verification' dialog, once a downloader is selected it reads a local fingerprint index and flags entries as 'Already local', 'Seeding on same site' or 'Suspicious: title+size only'." },
        { text: "Those are only markers. Nothing is quietly dropped from your task — to exclude them you have to tick 'Exclude already-local' yourself. That checkbox disappears when the base is a downloader entry: every row in that task is 'already local', which is the whole premise, so excluding them would empty the list." },
        { text: "'Rebuild local fingerprint index' sits right after that status line. Some clients cannot export a file list; then the top of the dialog says so ('This client cannot export a file list; only title+size screening') and only the title-and-size filter is available." },
      ],
    },
    {
      id: "buttons",
      title: "4. What each button on the 'Reseed Tasks' page does",
      points: [
        {
          title: "Set as base torrent",
          text: "Expand the row with the leading plus to see every entry in the task; the up arrow beside one moves it to first place, and 'Send base torrent' then sends that one.",
        },
        { title: "Send base torrent", text: "Sends only the first entry — use this to actually get the data down first." },
        {
          title: "Send other torrents",
          text: "Sends everything except the first entry. This is the reseed step. Sending several at once asks for confirmation.",
        },
        { title: "Send all torrents", text: "Sends everything, including the base entry." },
        {
          title: "Tasks whose base lives in the downloader",
          text: "A task created from the 'one ticked entry' route seeds onto a different torrent your downloader already has: an extra line under the title reads 'Base torrent (in downloader): ' and says which, and expanding the row shows only that one site entry to attach. Those tasks have no 'Send base torrent', no 'Send other torrents' and no 'Set as base torrent' - only 'Send this entry to reseed'.",
        },
        {
          title: "Copy download links",
          text: "Copies every download link in the task to the clipboard, one per line.",
        },
        {
          title: "Delete / Clear All",
          text: "Removes the task this assistant recorded. It does not touch anything your downloader is working on.",
        },
      ],
    },
    {
      id: "send",
      title: "5. What else happens when you send",
      points: [
        { text: "Whether a torrent starts immediately or is added paused follows that downloader's own 'Automatically start downloading when sending a torrent' switch (in the downloader settings). The 'Reseed Tasks' page adds no switch of its own." },
        { text: "Every entry is sent with 'skip hash checking' on: the data is already on disk, so that pass would only reread tens of gigabytes. Whether it is safe to skip was already decided when the task was created - only entries whose file list and contents match are picked automatically, anything else needs your own confirmation. Downloaders that don't know this option (anything but qBittorrent) still check as usual." },
        { text: "Because checking is skipped, 'the data actually isn't there' never surfaces as an error - only as a state. So about 18 seconds after you send, this page asks the downloader what it says about each torrent and writes the verdict into the 'Seeding' column (hover it to see every entry, including the client's own state string). You can also press 'Check seeding' in the toolbar at any time." },
        { text: "Entries the check finds 'not seeding properly' (missing files, a client error, or turned into an actual download) are paused immediately and a red notice tells you how many and why. 'Not found' and 'still checking' don't count as failures and are left alone - qBittorrent refreshes that list only every 15 seconds, so right after sending, not finding it is a normal in-between state." },
        { text: "The save path and label accept placeholders, substituted per entry: $torrent.title$, $torrent.subTitle$, $torrent.category$, $torrent.site$, $torrent.siteName$, $date:YYYY$, $date:MM$, $date:DD$." },
        { text: "The line under the title, 'Save Path: some downloader -> some path', is where this task will land. If nothing was set it reads 'Default Path'." },
      ],
    },
    {
      id: "auto",
      title: "6. Letting a task run itself: the 'Auto reseed' switch",
      lead:
        "On the screen where you create a reseed task, right next to the 'Create Task' button, there is an 'Auto reseed' switch, on by default. While it is on you don't have to sit there pressing buttons - the extension looks at that downloader once a minute:",
      points: [
        { title: "Step 1", text: "If the base entry is not in the downloader, the base gets sent first - and this one does NOT skip hash checking, because it's the entry that has to actually bring the data down." },
        { title: "Step 2", text: "Every minute it asks whether the base has finished, believing only the downloader's own 'is completed' report, not 'the state looks like seeding'. If the base was already complete from the start (or you picked an entry that is already seeding in the downloader) it goes straight to step 3." },
        { title: "Step 3", text: "Once the base is complete, the remaining entries are sent together, those with hash checking skipped - their contents were already compared file-by-file when the task was created." },
        { title: "After that", text: "It keeps watching every entry's seeding state. Anything found 'not seeding properly' (missing files, a client error, or turned into an actual download) is paused immediately, and one system notification says how many and where to look." },
        { text: "The 'Seeding' column shows exactly which step it reached (base sent / base downloading x% / base ready / reseeding n/m / done / N entries wrong) - you get that without pressing 'Check seeding' yourself." },
        { text: "The switch applies only to the task you are creating: tasks created earlier never start sending on their own just because you upgraded. Turning it off does not touch torrents already sent, and does not pause them for you." },
        { text: "When the downloader can't be reached that round does nothing - 'didn't find it' is never read as 'not in the downloader', so nothing gets re-sent or paused on that basis. If the base fails to show up in the downloader's list 3 times in a row, automatic retries stop and the reason is written to the 'Run Log'." },
      ],
    },
    {
      id: "risk",
      title: "7. Risk and responsibility",
      lead: "The three-item warning at the bottom of the 'Reseed Tasks' page is the boundary of what this feature promises. A few practical notes on top of it:",
      points: [
        { text: "Before reseeding, make sure your download client has 'auto start download' turned off. Adding paused, confirming the files really are where they should be, then starting is the safe order." },
        { text: "The assistant only performs a simple verification on the torrent files and does not guarantee that reseeding succeeds. The warning spells out that any fallout from a failed reseed is the user's own responsibility." },
        { text: "qBittorrent sometimes replies with just 'Fails.' and no details. When that happens the message points you at what to check: a duplicate torrent already present, an invalid save path or category, and qBittorrent's own logs." },
      ],
    },
  ],
};
