#!/usr/bin/env node
/**
 * 本地预览服务器（零依赖，只用 Node 内置模块）。
 *
 *   node dev/serve.js            # 默认 8777 端口
 *   node dev/serve.js 9000       # 指定端口
 *
 * 两件事：
 *   1. 静态托管工程目录（只读，不写任何东西）
 *   2. 动态生成 /dev/manifest.json —— 扫描 js/ 下全部 .js，供浏览器运行时按需 require
 *
 * 为什么动态生成而不写死清单：以后往 js/core 加文件不必回来改这里，
 * 少一处需要同步的地方就少一处会忘掉的地方。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { ROOT, buildManifest } = require('./manifest');

const PORT = Number(process.argv[2] || process.env.PORT || 8777);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    // 开发期禁用缓存：改完 config.js 刷新即可生效，不用清缓存
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  });
  res.end(body);
}

const server = http.createServer(function (req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  if (urlPath === '/dev/manifest.json') {
    const files = buildManifest();
    return send(res, 200, JSON.stringify(files), MIME['.json']);
  }

  // 预览页同时挂在根路径与 /dev/，两个入口都指向同一个文件
  const isPage = urlPath === '/' || urlPath === '/dev' || urlPath === '/dev/';
  const relative = isPage ? 'dev/index.html' : urlPath.replace(/^\/+/, '');
  const full = path.resolve(ROOT, relative);

  // 目录穿越防护：解析后的路径必须仍在工程目录内
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    process.stdout.write('  403  ' + urlPath + '\n');
    return send(res, 403, '禁止访问工程目录以外的路径');
  }

  fs.readFile(full, function (err, data) {
    if (err) {
      // 404 必须打到终端：<script> 加载失败是静默的，只有这里能看见
      process.stdout.write('  404  ' + urlPath + '\n');
      return send(res, 404, '找不到：' + relative);
    }
    send(res, 200, data, MIME[path.extname(full).toLowerCase()]);
  });
});

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach(function (name) {
    (nets[name] || []).forEach(function (net) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    });
  });
  return out;
}

server.listen(PORT, '0.0.0.0', function () {
  const jsCount = buildManifest().length;
  process.stdout.write('摩天叠楼师 · 本地预览已启动\n');
  process.stdout.write('  源码清单  ' + jsCount + ' 个 js 文件（由 js/ 实时扫描）\n');
  process.stdout.write('  本机      http://localhost:' + PORT + '/\n');
  lanAddresses().forEach(function (ip) {
    process.stdout.write('  局域网    http://' + ip + ':' + PORT + '/   （手机可开，能真触摸）\n');
  });
  process.stdout.write('  Ctrl+C 停止\n');
});
