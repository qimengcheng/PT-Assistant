<script setup lang="ts">
/**
 * 备份基础设置：备份文件加密密钥。
 * 注意：密钥修改后，之后导出的备份将使用新密钥加密；恢复旧备份时需要在恢复对话框中填写当时的密钥。
 */
import { useConfigStore } from "@/options/stores/config.ts";

const configStore = useConfigStore();
</script>

<template>
  <div class="backup-window">
    <a-form layout="vertical" class="compact-form">
      <div class="group">
        <div class="group-title">备份加密</div>
        <a-form-item label="备份文件加密密钥" extra="导出与远程备份将使用该密钥加密（AES），恢复时需要填写相同密钥。留空表示不加密。">
          <a-input-password
            v-model:value="configStore.backup.encryptionKey"
            placeholder="留空则不加密"
            autocomplete="new-password"
            style="max-width: 420px"
          />
        </a-form-item>
      </div>
    </a-form>
  </div>
</template>

