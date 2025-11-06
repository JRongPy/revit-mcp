import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export async function registerTools(server: McpServer) {
  // 获取当前文件的目录路径
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // 读取tools目录下的所有文件
  const files = fs.readdirSync(__dirname);

  // 过滤出.ts或.js文件，但排除index文件和register文件
  const toolFiles = files.filter(
    (file) =>
      (file.endsWith(".ts") || file.endsWith(".js")) &&
      file !== "index.ts" &&
      file !== "index.js" &&
      file !== "register.ts" &&
      file !== "register.js"
  );

  console.error("========================================");
  console.error("開始註冊 MCP Tools");
  console.error("========================================");

  let registeredCount = 0;
  let skippedCount = 0;

  // 动态导入并注册每个工具
  for (const file of toolFiles) {
    try {
      // 构建导入路径
      const importPath = `./${file.replace(/\.(ts|js)$/, ".js")}`;

      // 动态导入模块
      const module = await import(importPath);

      // ⭐ 檢查是否標記為跳過註冊
      if (module.SKIP_REGISTER === true) {
        console.error(`⏭️  跳過: ${file.padEnd(40)} (SKIP_REGISTER)`);
        skippedCount++;
        continue;
      }

      // 查找并执行注册函数
      const registerFunctionName = Object.keys(module).find(
        (key) => key.startsWith("register") && typeof module[key] === "function"
      );
      if (registerFunctionName) {
        module[registerFunctionName](server);
        console.error(`✅ 已註冊: ${file}`);
        registeredCount++;
      } else {
        console.error(`⚠️  警告: ${file.padEnd(40)} (未找到註冊函數)`);
      }
    } catch (error) {
       console.error(`❌ 錯誤: ${file.padEnd(40)} - ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.error("========================================");
  console.error(`註冊完成: ✅ ${registeredCount} 個 | ⏭️  ${skippedCount} 個已跳過`);
  console.error("========================================");
}
