const fs = require("fs");
const cheerio = require("cheerio");
const path = require("path");
const readline = require("readline");

// 让用户输入 flomo 导出的文件夹路径
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question(
  "请输入 flomo 导出的html所在文件夹的路径（例如 /Users/用户名/Downloads/flomo@xxx-20260531）：\n> ",
  (inputDir) => {
    rl.close();

    // 去除首尾空格和可能的引号
    inputDir = inputDir.trim().replace(/^['"]|['"]$/g, "");

    if (!fs.existsSync(inputDir)) {
      console.error(`❌ 文件夹不存在: ${inputDir}`);
      process.exit(1);
    }

    // 自动查找目录下唯一的 HTML 文件
    const htmlFiles = fs
      .readdirSync(inputDir)
      .filter((f) => f.endsWith(".html") || f.endsWith(".htm"));

    if (htmlFiles.length === 0) {
      console.error("❌ 该目录下未找到 HTML 文件");
      process.exit(1);
    }
    if (htmlFiles.length > 1) {
      console.error(
        `❌ 该目录下有多个 HTML 文件，请确保只有一个: ${htmlFiles.join(", ")}`
      );
      process.exit(1);
    }

    const inputPath = path.join(inputDir, htmlFiles[0]);
    const outputDir = path.join(inputDir, "output");

    console.log(`📄 找到 HTML 文件: ${htmlFiles[0]}`);
    console.log(`📂 输出目录: ${outputDir}`);

    // 创建输出目录
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 读取原始 HTML 文件
    const data = fs.readFileSync(inputPath, "utf8");
    const $ = cheerio.load(data);

    let successCount = 0;
    let errorCount = 0;
    const memos = $(".memo");
    const totalCount = memos.length;

    console.log(`\n🔍 共找到 ${totalCount} 条 MEMO，开始处理...\n`);

    memos.each((index, element) => {
      const $memo = $(element);
      const $time = $memo.find(".time");
      const $content = $memo.find(".content");
      const $files = $memo.find(".files");

      // 获取原始时间
      const timeText = $time.text().trim();

      // 解析时间为 Date 对象，用于设置文件创建时间
      const memoDate = parseFlomoTime(timeText);

      // 获取内容的第一行文本，用于文件名
      const firstLineText = getFirstLineText($content, $);

      // 重新组织 memo 的结构：time 移到最后
      $time.remove();
      $memo.append($time);

      // === 图片：复制附件 + 使用绝对路径 ===
      const attachments = [];

      $memo.find("img").each((_, img) => {
        const src = $(img).attr("src");
        if (src && src.startsWith("file/")) {
          const srcFullPath = path.join(inputDir, src);
          const destFullPath = path.join(outputDir, src);
          attachments.push({ src: srcFullPath, dest: destFullPath });
          $(img).attr("src", `file://${destFullPath}`);
        }
      });

      // === 音频：Apple Notes 不支持 <audio> 标签，保留原样展示转录文本 ===
      // 保持 audio-player 结构不变，导入后显示为转录文本
      // <audio> 标签在 Apple Notes 中会被忽略，转录文本会正常显示

      // 复制附件到 output 目录
      for (const att of attachments) {
        try {
          const destDir = path.dirname(att.dest);
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }
          if (fs.existsSync(att.src)) {
            fs.copyFileSync(att.src, att.dest);
          } else {
            console.warn(`  ⚠️ 附件不存在，跳过: ${att.src}`);
          }
        } catch (e) {
          console.warn(`  ⚠️ 复制附件失败: ${att.src} -> ${e.message}`);
        }
      }

      // 将时间格式化为合法的文件名：日期时间 + 第一行内容
      const timeForName = timeText.replace(/:/g, "-").replace(/\s/g, "_");
      let fileName;
      if (firstLineText) {
        // 清理文件名中的非法字符，限制长度
        const cleanTitle = firstLineText
          .replace(/[\/\\:*?"<>|]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .substring(0, 50);
        fileName = `${timeForName}_${cleanTitle}.html`;
      } else {
        fileName = `${timeForName}.html`;
      }
      let outputPath = path.join(outputDir, fileName);

      // 获取 memo 的 HTML 内容
      const memoHtml = $memo.prop("outerHTML");

      // 创建新的 HTML 内容
      const newHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
</head>
<style type="text/css">
  .time {
      color: #8d8d8d;
      font-size: 12px;
  }
  .content {
      color: #323232;
      font-size: 14px;
  }
  .content p {
      line-height: 1.8;
      min-height: 20px;
      margin: 0;
  }
  .content ul, .content ol {
      padding-inline-start: 22px;
      margin: 0;
  }
  .content li {
      line-height: 1.8;
  }
  .files img {
      max-width: 100%;
      border: 1px solid #e6e6e6;
      border-radius: 4px;
      margin: 6px 0;
  }
  mark {
      background-color: #fff3b0;
      padding: 1px 3px;
      border-radius: 2px;
  }
  .audio-player {
      width: 100%;
      background: #f7f7f7;
      border-radius: 6px;
      margin-top: 10px;
      padding: 10px;
      box-sizing: border-box;
  }
  .audio-player audio {
      width: 100%;
  }
  .audio-player__content {
      padding-top: 10px;
      margin-top: 10px;
      border-top: 1px solid #eeeeee;
      font-size: 14px;
      color: #555555;
      line-height: 1.8;
      white-space: pre-wrap;
      word-wrap: break-word;
  }
</style>
<body>
    ${memoHtml}
</body>
</html>`;

      // 写入新文件
      try {
        fs.writeFileSync(outputPath, newHtml, "utf8");

        // 设置文件的创建时间和修改时间为 memo 的原始时间
        if (memoDate) {
          fs.utimesSync(outputPath, memoDate, memoDate);
        }

        successCount++;
        const progress = `[${successCount + errorCount}/${totalCount}]`;
        console.log(`  ✅ ${progress} ${fileName}`);
      } catch (err) {
        errorCount++;
        console.error(`  ❌ 写入文件 ${fileName} 失败:`, err.message);
      }
    });

    console.log(`\n🎉 处理完成！成功: ${successCount}，失败: ${errorCount}`);
    console.log(`📂 输出目录: ${outputDir}`);

    if (successCount > 0) {
      console.log(
        `\n💡 提示: 现在可以将 output 目录下的 HTML 文件导入 Apple Notes 了。`
      );
      console.log(
        `   每个文件的创建/修改时间已设为对应笔记的原始时间。`
      );
      console.log(
        `   ⚠️ #标签需要在 Apple Notes 中手动点击激活（Apple Notes 限制）。`
      );
      console.log(
        `   ⚠️ <mark>高亮标记在 Apple Notes 中不生效（Apple Notes 限制）。`
      );
      console.log(
        `   ⚠️ 音频文件无法通过 HTML 导入到 Apple Notes（Apple Notes 限制）。`
      );
    }
  }
);

/**
 * 解析 flomo 时间格式 "2026-05-29 15:04:07" 为 Date 对象
 */
function parseFlomoTime(timeStr) {
  if (!timeStr) return null;
  // 格式: "YYYY-MM-DD HH:mm:ss"
  const match = timeStr.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(year, month - 1, day, hour, minute, second);
}

/**
 * 从 content 中提取第一行纯文本，用于文件名
 * 跳过 #标签 开头的行，取有实际内容的第一行
 */
function getFirstLineText($content, $) {
  // 获取所有文本内容
  const fullText = $content.text().trim();
  if (!fullText) return "";

  // 按换行拆分，找到第一个有意义的行
  const lines = fullText.split(/\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // 跳过纯标签行（如 "#读书 "）
    const withoutTags = line.replace(/#\S+\s*/g, "").trim();
    if (withoutTags.length > 0) {
      return withoutTags;
    }
    // 如果整行都是标签，就用标签本身
    if (line.length > 0) {
      return line;
    }
  }

  return "";
}
