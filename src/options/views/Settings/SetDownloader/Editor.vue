<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { computedAsync } from "@vueuse/core";
import { format } from "date-fns";

import type { IDownloaderMetadata } from "@/shared/types.ts";
import { formValidateRules } from "@/options/utils.ts";
import { getDownloader, getDownloaderMetaData, type TorrentClientMetaData } from "@ptd/downloader";

import ConnectCheckButton from "@/options/components/ConnectCheckButton.vue";

const { t } = useI18n();

const clientConfig = defineModel<IDownloaderMetadata>();

const clientMeta = computedAsync<TorrentClientMetaData>(
  async () =>
    clientConfig.value?.type ? await getDownloaderMetaData(clientConfig.value.type) : ({} as TorrentClientMetaData),
  {} as TorrentClientMetaData,
);

const showPassword = ref<boolean>(false);

const formRef = ref();

/**
 * 把表单有效性对外播报，供 AddDialog / EditDialog 的 OK 键门控。
 *
 * ⚠️ 原来这里只在「测试连接」按钮里 validateForm()，提交路径完全没校验：
 * 空名称 / 非法 URL 可以直接落库，之后连接必然失败，而用户要等到真用上
 * 才发现。SetSite 与 SetBackup 的 Editor 都有这条 emit，本组件漏了。
 *
 * a-form 的校验默认只在 blur / 提交时跑，不会像 Vuetify 那样自动回写结果，
 * 所以要手动重算：触发点挂在带 rules 的那三个输入控件的 @change 上
 * （a-form 自己没有 change 这个 emit，挂它上面等于没挂，见模板那条注释）。
 */
const emits = defineEmits<{
  (e: "update:form-valid", valid: boolean): void;
}>();

const formValid = ref<boolean>(false);

watch(formValid, (v) => emits("update:form-valid", v), { immediate: true });

/**
 * 把 formValidateRules 的判据包成 a-form 认得的返回形状。
 *
 * ⚠️ 这条不是风格问题，是「校验整条死掉」和「能用」的区别：antdv-next 的
 * `dist/form/utils/validateUtil.js` 里对 rule.validator 的那层包装，只在返回值是
 * Promise 时才调用 callback（`hasPromise = promise && typeof promise.then === "function"`），
 * 而 formValidateRules 的 validator 同步返回 boolean|string。直接挂进 :rules 的话，
 * 那次 callback 永远不发生，validate()/validateFields() 的 Promise 既不 resolve 也不 reject
 * （台架 .tmp-build/bench-dlvalid：真组件里 validateFields() 挂 2s 不 settle）。
 * 界面表现是三头一起死：字段下的错误提示不出、原来「测试连接」按钮一直转圈
 * （它 await 的就是这个 validateForm()）、以及本次新增的 OK 键门控永久禁用。
 * 判据仍复用 utils 里那一份，这里只换返回形状。
 *
 * 形参必须是 `(rule, value)` 两个：validateUtil 那层包装是
 * `originValidatorFunc(rule, val, wrappedCallback)`，第一个参数是规则对象本身
 * （CustomSolutionDialog.vue:83 也是这么写的）。只写一个参数时拿到的是 rule，
 * 判据会把 "[object Object]" 当地址去跑正则 —— 合法的地址也会被拒（台架第一轮就是这么撞出来的）。
 */
function toAsyncValidator(check: (v: any) => boolean | string) {
  return (_rule: any, value: any) => {
    const result = check(value);
    return result === true ? Promise.resolve() : Promise.reject(new Error(String(result)));
  };
}

async function validateForm() {
  if (!formRef.value) return false;
  try {
    await formRef.value.validateFields();
    return true;
  } catch {
    return false;
  }
}

function syncFormValid() {
  validateForm().then((valid) => (formValid.value = valid));
}

// 打开弹窗时表单已经带上默认值/已存的值，不先同步一次的话 formValid 停在 false，
// 内容明明合法但「确定」点不动（SetBackup/Editor 同样有这一条）。
onMounted(syncFormValid);

async function checkConnect(): Promise<boolean> {
  const valid = await validateForm();
  if (!valid) return false;
  try {
    const client = await getDownloader(clientConfig.value!);
    return await client.ping();
  } catch {
    return false;
  }
}

function formatTimeout(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const timeoutColor = computed(() => {
  const ms = clientConfig.value?.timeout ?? 0;
  if (ms > 8 * 60e3) return "red";
  if (ms > 5 * 60e3) return "orange";
  return "green";
});

const advanceOptions = computed(() => clientMeta.value?.advanceAddTorrentOptions ?? []);
const showAutoStart = computed(() => clientMeta.value?.feature?.DefaultAutoStart?.allowed === true);
const showBypassCsrf = computed(() => clientMeta.value?.feature?.BypassCSRF?.allowed === true);
</script>

<template>
  <!-- 重新校验挂在三个带 rules 的输入控件上，不挂在 a-form 上：a-form 声明的 emits 是
       finish / finishFailed / submit / reset / validate / valuesChange / fieldsChange，
       没有 change（antdv-next/dist/form/Form.js 的 emits 数组），而它又 inheritAttrs:false，
       所以 @change 落不到任何地方 —— 那样 formValid 会永远停在 false，
       AddDialog 的「确定」永久禁用，等于加不了下载器。本仓 SetBackup/Editor 一直是
       挂在控件上的，照它写。 -->
  <a-form v-if="clientConfig" ref="formRef" :model="clientConfig" layout="vertical" class="dl-editor">
    <a-row :gutter="12">
      <a-col :span="24" :md="6">
        <a-form-item :label="t('common.type')">
          <a-input v-model:value="clientConfig.type" disabled />
        </a-form-item>
      </a-col>
      <a-col :span="24" :md="8">
        <a-form-item
          :label="t('SetDownloader.common.name')"
          name="name"
          :rules="[
            {
              validator: toAsyncValidator(formValidateRules.require(t('SetDownloader.editor.nameTip'))),
              trigger: 'blur',
            },
          ]"
        >
          <a-input
            v-model:value="clientConfig.name"
            :placeholder="t('SetDownloader.common.name')"
            @change="syncFormValid"
          />
        </a-form-item>
      </a-col>
      <a-col :span="24" :md="7">
        <a-form-item :label="t('SetDownloader.common.uid') + t('SetDownloader.editor.uidPlaceholder')">
          <a-input v-model:value="clientConfig.id" disabled />
        </a-form-item>
      </a-col>
      <a-col :span="24" :md="3">
        <a-form-item :label="t('common.sortIndex')" name="sortIndex" :rules="[{ required: true }]">
          <a-input-number v-model:value="clientConfig.sortIndex" style="width: 100%" @change="syncFormValid" />
        </a-form-item>
      </a-col>
    </a-row>

    <a-form-item
      :label="t('SetDownloader.common.address')"
      name="address"
      :rules="[
        {
          validator: toAsyncValidator(formValidateRules.url(t('SetDownloader.editor.addressTip'))),
          trigger: 'blur',
        },
      ]"
    >
      <a-input v-model:value="clientConfig.address" @change="syncFormValid" />
    </a-form-item>

    <a-row :gutter="12">
      <a-col v-if="typeof clientConfig.username !== 'undefined'" :span="24" :md="12">
        <a-form-item :label="t('common.username')" name="username">
          <a-input v-model:value="clientConfig.username" />
        </a-form-item>
      </a-col>
      <a-col :span="typeof clientConfig.username === 'undefined' ? 24 : 12" :md="12">
        <a-form-item :label="t('SetDownloader.editor.password')" name="password">
          <a-input-password
            v-model:value="clientConfig.password"
            :visibility-toggle="true"
          />
        </a-form-item>
      </a-col>
    </a-row>

    <a-form-item :label="t('SetDownloader.editor.timeout')">
      <div class="timeout-row">
        <a-slider
          v-model:value="clientConfig.timeout"
          :min="0"
          :max="10 * 60e3"
          :step="1e3"
          :tooltip="{ formatter: (v: number) => formatTimeout(v) }"
        />
        <!-- 这颗既是当前值也是「一键回到 10 秒」，跟滑块同一行才不额外占一档行高 -->
        <a-button type="text" class="timeout-value" @click="clientConfig.timeout = 10e3">
          {{ formatTimeout(clientConfig.timeout ?? 0) }}
        </a-button>
      </div>
    </a-form-item>

    <div v-if="showAutoStart || showBypassCsrf" class="switch-grid">
      <div v-if="showAutoStart" class="switch-row">
        <div class="switch-row-text">
          <div class="switch-row-label">{{ t("SetDownloader.editor.autoStart") }}</div>
        </div>
        <a-switch
          v-model:checked="clientConfig.feature!.DefaultAutoStart"
          size="small"
          :checked-children="t('SetDownloader.editor.switchOn')"
          :un-checked-children="t('SetDownloader.editor.switchOff')"
        />
      </div>
      <div v-if="showBypassCsrf" class="switch-row">
        <div class="switch-row-text">
          <div class="switch-row-label">{{ t("SetDownloader.editor.bypassCsrf") }}</div>
          <div class="form-tip">{{ t("SetDownloader.editor.bypassCsrfTip") }}</div>
        </div>
        <a-switch v-model:checked="clientConfig.feature!.BypassCSRF" size="small" />
      </div>
    </div>

    <a-collapse v-if="advanceOptions.length > 0" bordered ghost class="advance-collapse">
      <a-collapse-panel :key="1" :header="t('common.advancedSettings')">
        <div class="switch-grid switch-grid--plain">
          <div v-for="opt in advanceOptions" :key="opt.key" class="switch-row">
            <div class="switch-row-text">
              <div class="switch-row-label">{{ opt.name }}</div>
              <div v-if="opt.description" class="form-tip">{{ opt.description }}</div>
            </div>
            <a-switch v-model:checked="clientConfig.advanceAddTorrentOptions![opt.key]" size="small" />
          </div>
        </div>
      </a-collapse-panel>
    </a-collapse>

    <div class="check-row">
      <ConnectCheckButton :check-fn="checkConnect" :reset-timeout="3e3" />
    </div>

    <a-alert v-if="clientMeta?.warning?.length" type="warning" show-icon>
      <template #message>
        <ul style="margin: 0; padding-left: 20px">
          <li v-for="(data, index) in clientMeta.warning" :key="index">{{ data }}</li>
        </ul>
      </template>
    </a-alert>
  </a-form>
</template>

<style scoped>
/* 原先每个开关都是一个 a-form-item：标签在上、开关在下，再加 24px 下边距 ——
   一个 16px 高的控件吃掉约 90px 竖向空间（截图量到相邻两颗开关的间距 102 图像 px
   ÷ DPR 1.25 ≈ 82 CSS px），弹窗因此整片滚动。改成「标签左、开关右」的一行一档。 */
.dl-editor :deep(.ant-form-item) {
  margin-bottom: 12px;
}

.switch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 0 24px;
  margin-bottom: 12px;
  padding: 2px 12px;
  border: 1px solid var(--pt-color-border-light);
  border-radius: 8px;
}

/* 高级设置里那一组已经在折叠面板内，不再另给一层表面 */
.switch-grid--plain {
  padding: 0;
  border: none;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 40px;
}

.switch-row-text {
  min-width: 0;
}

.switch-row-label {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.88);
}

.timeout-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.timeout-row :deep(.ant-slider) {
  flex: 1 1 0;
  min-width: 0;
  margin-bottom: 0;
}

.timeout-value {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}

/* 检查连接性那颗是 block 按钮（媒体服务器/备份那两页要满宽），这里收回到内容宽 */
.check-row {
  display: flex;
  margin-bottom: 12px;
}

.check-row > .ant-btn {
  width: auto;
  padding-inline: 4px;
}

.form-tip {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  margin-top: 2px;
}
</style>
