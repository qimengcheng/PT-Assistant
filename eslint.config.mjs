/**
 * ESLint 扁平配置（eslint 10 只认这一种）。
 *
 * 冷接入的取向，写在前面免得后来人以为这套规则可以随便加严：
 *  - **CI 只 gate error**，warning 不算失败。首轮把「观感类」全降成 warning，是为了让
 *    「接入 ESLint」这一条提交本身能落地；真要收口时逐条升 error，升之前先看它报了多少处。
 *  - **`packages/**` 是上游零修改平移**（site 340 个定义、downloader / social 等），
 *    不能为了喂饱一个新装的 linter 去改上游代码，所以那一块只留「确定是 bug」的档。
 *  - 现有 12 条静态防线里哪些能被 ESLint 替掉、哪些替不掉，结论在 README「工程化体系」那张表旁边。
 *
 * 用法：`node ./node_modules/eslint/bin/eslint.js .`（与 `pnpm lint` 同一个入口）
 */
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      ".output/**",
      ".wxt/**",
      ".tmp-build/**",
      ".workbuddy/**",
      "dist-*/**",
      "tobedeleted/**",
      "coverage/**",
      "**/*.d.ts",
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommended,
  // 预设里**后三条没有 `files`**（83 + 25 + 8 条规则），于是 vue 的模板规则会去跑 `.ts` / `.mjs`：
  // 实测 `vue/one-component-per-file` 就是在 `scripts/check-content-antd-lite.mjs` 的
  // `createApp({ render: () => null })` 上报出来的 —— 那条规则把「带 `render` 属性的对象字面量」
  // 数成组件定义。这里把「有规则但没 files」的三条钉回 `.vue`；前两条一条只注册插件、
  // 一条本来就限 `.vue`，原样留着（给插件注册那条加 files 会让 `.ts` 侧取不到 vue 插件，直接报错）。
  ...pluginVue.configs["flat/recommended"].map((entry) =>
    !entry.files && Object.keys(entry.rules ?? {}).length > 0 ? { ...entry, files: ["**/*.vue", "*.vue"] } : entry,
  ),

  // —— 扩展内的代码：浏览器 + WebExtension 全局
  {
    files: ["src/**/*.{ts,tsx,vue}", "packages/**/*.{ts,vue}", "entrypoints/**/*.{ts,vue}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        // wxt.config.ts 的 vite.define 注入的三个编译期常量（类型声明在 src/vite-env.d.ts）。
        // 不在这里点名 `no-undef` 就会把 `__EXT_VERSION__` 这类当拼错的全局报出来。
        __BROWSER__: "readonly",
        __EXT_VERSION__: "readonly",
        __RESOURCE_SITE_ICONS__: "readonly",
      },
    },
  },

  // —— 构建 / 守卫脚本：Node 全局，那边没有 window
  {
    files: ["scripts/**/*.mjs", "wxt.config.ts", "*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
  },

  // —— 规则：确定会咬人的留 error，观感 / 迁移期噪声降 warning
  {
    files: ["**/*.{ts,tsx,vue,mjs}"],
    languageOptions: {
      parserOptions: { parser: tseslint.parser }, // .vue 的 <script lang="ts">
    },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-async-promise-executor": "error",
      "no-dupe-keys": "error",
      // 注释里合法地引用怪空格（scripts/gen-agent-stats.mjs 就在写「真有一条带 U+FEFF 的提交」），
      // 字符串仍然照查 —— 那才是会画到界面上的那一份。
      "no-irregular-whitespace": ["error", { skipComments: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "vue/no-mutating-props": "error",
      "vue/valid-template-root": "error",
      "vue/no-parsing-error": "error",
      "vue/no-unused-components": "error",
      "vue/no-unused-refs": "error",
      "vue/require-valid-default-prop": "error",
      "vue/return-in-computed-property": "error",
      "vue/no-v-html": "error", // 站内信正文不许 v-html（项目硬约定）

      // —— 下面三组是「原来只有口头约定、没有守卫」的那几项（PLAYBOOK §9 / §11 / AGENTS §3.2），
      //    接进 ESLint 就等于凭空多出三条防线。现存命中全在注释里，所以门禁不会因此变红。

      // 原生对话框在 MV3 扩展页里被禁用：调用**静默返回 null / false**，不报错。
      // 正解是 appDialog 那套（modal.confirm / 自绘 prompt）。
      "no-restricted-globals": [
        "error",
        { name: "confirm", message: "确认框一律走 appDialog 的 makeConfirmDanger / modal.confirm —— 原生 confirm 在扩展页里静默返回 false（PLAYBOOK §9）" },
        { name: "alert", message: "提示走 message / notification；原生 alert 在扩展页里被禁用（PLAYBOOK §9）" },
        { name: "prompt", message: "输入走 usePromptInDialog；原生 prompt 静默返回 null（PLAYBOOK §9）" },
      ],
      "no-restricted-syntax": [
        "error",
        // 同一条规则的成员：数组里每一项都是 { selector, message }。
        // 1) 确认框那颗键不许写 legacy 的 okType:"danger" —— 它出来是红描边不是实心红，
        //    而 class 里照样带 .ant-btn-dangerous（AGENTS §3.4 那条，原防线 ⑪ 由这里接手）。
        //    注释里的反例天然不算：esquery 只走 AST，不看注释。
        {
          selector: "Property[key.name='okType']",
          message: '确认框改用 okButtonProps: { type: "primary", danger: true } —— okType:"danger" 只折出 danger、不给 type，出来是红描边',
        },
        // 2) 系统通知必须带 id（原防线 ⑫ 的 A 条由这里接手）：
        //    chrome.notifications?.create({...}) 少第一个参数 = 谁都认领不了这条通知。
        {
          selector:
            "CallExpression[callee.object.property.name='notifications'][callee.property.name='create'][arguments.0.type='ObjectExpression']",
          message: "notifications.create 的第一参数必须是 id 字符串（chrome.notifications.onClicked 是全局事件，没 id 就没人认领得了）",
        },
        // 3) window.confirm / window.alert / window.prompt 走的是成员访问，no-restricted-globals 看不见
        {
          selector: "MemberExpression[object.name='window'][property.name=/^(confirm|alert|prompt)$/]",
          message: "原生对话框在扩展页里被禁用（静默返回 null/false），走 appDialog 那套（PLAYBOOK §9）",
        },
      ],
      // 模板侧的同一件事得交给插件自己的规则：**核心 no-restricted-syntax 看不见 Vue 模板 AST**。
      // 实测：一个只写 `<a-popconfirm ok-type="danger" />` 的探针文件，对 `VAttribute`、
      // `VAttribute[key.name='ok-type']`、`VElement[name='a-popconfirm']` 三条 selector 全部零命中
      // —— 也就是说「把 ⑪ 整条换成 esquery」是假的接管，模板那一半会静默失效。
      "vue/no-restricted-static-attribute": [
        "error",
        {
          key: "ok-type",
          message: '确认框那颗键改用 :ok-button-props="{ type: \'primary\', danger: true }" —— ok-type="danger" 出来是红描边不是实心红',
        },
      ],
      // 上面那条只管**静态**属性；`:ok-type="tone"` / `:okType="tone"` 这种动态写法它看不见，
      // 而原防线 ⑪ 是按文本扫的，两种都抓得到。不补这一条就是拿接管的名义留一道缝。
      "vue/no-restricted-v-bind": [
        "error",
        {
          argument: "/^ok-type$/",
          message: '动态绑定也不行：改用 :ok-button-props="{ type: \'primary\', danger: true }"（ok-type 走 legacy 映射，出来是红描边）',
        },
        {
          argument: "/^okType$/",
          message: "同上，改用 :ok-button-props（okType 是 antdv-next 确认框的 legacy 入口）",
        },
      ],

      // 观感与迁移期噪声
      "vue/attributes-order": "warn",
      "vue/max-attributes-per-line": "off",
      "vue/singleline-html-element-content-newline": "off",
      "vue/multiline-html-element-content-newline": "off",
      "vue/html-self-closing": "off",
      "vue/html-indent": "off",
      "vue/first-attribute-linebreak": "off",
      "vue/require-default-prop": "off",
      "vue/require-prop-types": "off",
      "vue/multi-word-component-names": "off",
      // 这两条在 v0.90.9 升成 error：我们自己那份（src / scripts / 根配置）已经逐文件收口到
      // 0 条（any 221 → 0、@ts-ignore 10 → 0，剩下的全在 packages 那片中），所以不再有
      // 「先让门禁落地」的理由留着 warn。
      // 真要留一处 any（第三方 loose 类型、或跨上下文的动态消息名）就在上一行写行级
      // disable 注释、并在它上面把实测依据讲清楚 —— TKonvaConfig 就是这样的先例。
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
    },
  },

  // —— 我们自己写的代码：不许 import 没声明的包（PLAYBOOK §11 的 `dayjs` 那条口头约定由这里接手）。
  // 换成 isolated 布局后裸 `import dayjs` 本来就会在解析阶段炸，但炸出来的是 ERR_MODULE_NOT_FOUND，
  // 读不出「该显式声明还是该改用 dateStrings」，所以点名禁掉、把话讲清楚。
  {
    files: ["src/**/*.{ts,tsx,vue}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "dayjs",
              message: "dayjs 没写进 package.json（它只是 antdv-next 的传递依赖）。日期区间用 range-picker @change 的第二参数 dateStrings + 原生 Date；真要用的话得先显式声明（PLAYBOOK §11）",
            },
          ],
        },
      ],
    },
  },

  // —— 上游零修改平移件：只留「确定是 bug」的档。
  // 这一片是 site 340 个定义 + downloader / social / backupServer / mediaServer，本仓的口径是不改上游，
  // 所以它们报出来的东西**不进门禁**（error 会让 CI 红，而红的原因是我们刚装了个 linter，
  // 不是上游坏了）。要清这些得单开一次「上游复核」，跟着 upstream 的版本号走，不混在这里。
  {
    files: ["packages/**/*.{ts,vue}"],
    rules: {
      // 上面两条刚升到 error，这一片必须按原样留在 warn —— 那 230 + 17 处是上游写法，
      // 不改上游是本仓的硬口径。回涨由 scripts/check-eslint.mjs 的那份基线快照拦。
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-unnecessary-type-constraint": "warn",
      "no-useless-assignment": "warn",
      "no-useless-escape": "warn",
      "no-irregular-whitespace": "warn",
      "no-extra-boolean-cast": "warn",
      "preserve-caught-error": "warn",
      "prefer-const": "warn",
      "vue/no-v-html": "warn",
    },
  },
);
