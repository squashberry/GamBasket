import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4173);
const contentTypes = new Map([
  [".html","text/html; charset=utf-8"],[".js","text/javascript; charset=utf-8"],
  [".mjs","text/javascript; charset=utf-8"],[".css","text/css; charset=utf-8"],
  [".json","application/json; charset=utf-8"],[".svg","image/svg+xml"],
  [".png","image/png"],[".jpg","image/jpeg"],[".jpeg","image/jpeg"],
  [".webp","image/webp"],[".ico","image/x-icon"],[".woff2","font/woff2"]
]);

const server = http.createServer((req,res)=>{
  if(req.url==="/health"){res.writeHead(200,{"content-type":"text/plain"});res.end("ok");return;}
  let pathname;
  try { pathname=decodeURIComponent(new URL(req.url,"http://127.0.0.1").pathname); }
  catch { res.writeHead(400);res.end("Bad request");return; }
  if(pathname.includes("\\0")){res.writeHead(400);res.end("Bad request");return;}
  if(pathname==="/")pathname="/index.html";
  const target=path.resolve(root,"."+pathname);
  if(target!==root&&!target.startsWith(root+path.sep)){res.writeHead(403);res.end("Forbidden");return;}
  fs.stat(target,(err,stat)=>{
    if(err||!stat.isFile()){res.writeHead(404,{"content-type":"text/plain; charset=utf-8"});res.end("Not found");return;}
    res.writeHead(200,{"content-type":contentTypes.get(path.extname(target).toLowerCase())||"application/octet-stream","cache-control":"no-store","x-content-type-options":"nosniff"});
    fs.createReadStream(target).pipe(res);
  });
});
server.listen(port,"127.0.0.1",()=>console.log(`GamBasket test server listening at http://127.0.0.1:${port}`));
process.on("SIGTERM",()=>server.close(()=>process.exit(0)));
process.on("SIGINT",()=>server.close(()=>process.exit(0)));
