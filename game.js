// game.js — Full-res (pre-optimization) build
// 월드/건물/문/실내-외 오버레이(채도 0.5, 2초 페이드) + 컨테이너 스폰 + 루팅 UI + 힌트

export function start(canvas) {
  const d = document, w = window;
  const ctx = canvas.getContext('2d', { alpha: false });

  // === View / DPI ===
  let DPR = Math.max(1, Math.min(2, w.devicePixelRatio || 1));
  function resize() {
    DPR = Math.max(1, Math.min(2, w.devicePixelRatio || 1));
    canvas.width  = Math.floor(w.innerWidth  * DPR);
    canvas.height = Math.floor(w.innerHeight * DPR);
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
  }
  w.addEventListener('resize', resize); resize();

  // === Constants ===
  const TILE = 16;
  const CT   = 64;              // tiles per chunk edge
  const CS   = CT * TILE;       // px per chunk edge
  const K    = (x,y)=> x+'|'+y;

  // === Input ===
  const key = {};
  d.addEventListener('keydown', e => key[e.key.toLowerCase()] = true);
  d.addEventListener('keyup',   e => key[e.key.toLowerCase()] = false);

  // === UI ===
  const ui = d.createElement('div');
  ui.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:14px system-ui;color:#e7e7ea';
  ui.innerHTML = `
    <div style="position:absolute;left:8px;top:8px;background:#141922cc;border:1px solid #2b2f39;border-radius:10px;padding:6px 10px;pointer-events:auto">
      <b>시간</b> <span id="t">00:00</span>
    </div>
    <div id="inv" style="position:absolute;left:8px;top:48px;background:#141922cc;border:1px solid #2b2f39;border-radius:10px;padding:6px 10px;display:flex;gap:8px;pointer-events:auto"></div>
    <div id="hint" style="position:absolute;left:50%;top:70%;transform:translate(-50%,0);background:#0009;border:1px solid #2b2f39;border-radius:10px;padding:6px 10px;display:none;pointer-events:none">E 상호작용</div>
    <div id="loot" style="display:none;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:420px;max-width:92vw;max-height:70vh;overflow:auto;background:#0f1319f2;border:1px solid #2b2f39;border-radius:14px;padding:10px;box-shadow:0 4px 30px rgba(0,0,0,.45);pointer-events:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
        <b id="lootT">루팅</b>
        <span><button id="takeAll">모두</button><button id="closeL">닫기[ESC]</button></span>
      </div>
      <div id="lootG" style="display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center"></div>
      <div style="text-align:right;margin-top:6px"><small id="cap">0/0</small></div>
    </div>
  `;
  d.body.appendChild(ui);
  const uiTime = ui.querySelector('#t');
  const uiInv  = ui.querySelector('#inv');
  const lootEl = ui.querySelector('#loot');
  const lootT  = ui.querySelector('#lootT');
  const lootG  = ui.querySelector('#lootG');
  const capEl  = ui.querySelector('#cap');
  const hintEl = ui.querySelector('#hint');

  ui.querySelector('#closeL').onclick = ()=>{ S.uiLoot=false; lootEl.style.display='none'; };
  ui.querySelector('#takeAll').onclick = ()=> takeAll(S.openedCont);

  // === State ===
  const S = {
    seed:  (Date.now()>>>0) ^ (Math.random()*1e9|0),
    cam:   { x: 0, y: 0 },
    p:     { x: 32, y: 32, vx:0, vy:0, spd: 1.6, ldx:1, ldy:0, carry:0, cap:50 },
    time:  0,
    chunks:new Map(),
    inside:null,       // 현재 플레이어가 있는 방 객체
    ovA:   0,          // 실내 시 외부 오버레이 알파 (0→1)
    fadeInSec: 2,      // 실내 진입 페이드 시간
    uiLoot:false,
    openedCont:null,
    inv: { wood:0, scrap:0, food:0 },
    nearPrompt:false
  };

  // === RNG ===
  function m32(a){ return function(){ let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296; } }
  const rng = m32(S.seed);
  function RI(r,a,b){ return Math.floor(r()*(b-a+1))+a; }

  // === Coords ===
  function W2C(x,y){ let cx=Math.floor(x/CS), cy=Math.floor(y/CS);
    if(x<0 && x%CS!==0) cx=Math.floor((x-CS+1)/CS);
    if(y<0 && y%CS!==0) cy=Math.floor((y-CS+1)/CS);
    return {cx,cy};
  }
  function P2G(x,y){ return { gx:Math.round(x/TILE), gy:Math.round(y/TILE) }; }
  function G2P(gx,gy){ return { x:gx*TILE, y:gy*TILE }; }
  function CK(cx,cy){ return cx+'|'+cy; }

  // === World / Chunks ===
  function getChunk(cx,cy){ return S.chunks.get(CK(cx,cy)); }
  function setChunk(cx,cy,ch){ S.chunks.set(CK(cx,cy), ch); }
  function sRng(cx,cy){ const h=(cx*73856093 ^ cy*19349663 ^ S.seed)>>>0; return m32(h); }

  function newChunk(cx,cy){
    return { cx,cy,
      floors:new Set(), woodFloors:new Set(), walls:new Set(), solid:new Set(),
      rooms:[], doors:new Map(),
      cont:[]
    };
  }

  function genChunk(cx,cy){
    const ch = newChunk(cx,cy), r = sRng(cx,cy);
    const gx0 = cx*CT, gy0 = cy*CT;

    // 방 생성
    const count = RI(r,2,4), margin=4;
    let guard = 0;
    while (ch.rooms.length < count && guard < 60) {
      guard++;
      const w=4+RI(r,0,6), h=4+RI(r,0,6);
      const bx=RI(r,gx0+margin, gx0+CT-margin-w);
      const by=RI(r,gy0+margin, gy0+CT-margin-h);
      if (isBusy(ch,bx,by,w,h)) continue;
      addRoom(ch,bx,by,w,h,r);
    }

    postOverlap(ch);
    spawnContainers(ch, r, gx0, gy0);

    // 시작 청크(0,0)에는 최소 6개 보장
    if (cx===0 && cy===0 && ch.cont.length < 6) {
      forceStarterContainers(ch);
    }
    return ch;
  }

  function isBusy(ch,bx,by,w,h){
    for(let x=bx-1; x<bx+w+1; x++)
      for(let y=by-1; y<by+h+1; y++){
        const k=K(x,y);
        if(ch.floors.has(k)||ch.woodFloors.has(k)||ch.walls.has(k)||ch.solid.has(k))
          return true;
      }
    return false;
  }

  function placeDoor(ch,bx,by,w,h,r){
    const side = RI(r,0,3);
    let gx = side===1?bx+w-1 : side===3?bx : RI(r,bx+1,bx+w-2);
    let gy = side===0?by      : side===2?by+h-1 : RI(r,by+1,by+h-2);
    const k = K(gx,gy);
    if (ch.walls.has(k)) {
      ch.walls.delete(k); ch.solid.delete(k);
      ch.doors.set(k,{ x:gx*TILE, y:gy*TILE, open:false, dir:(side===0||side===2)?'h':'v' });
    }
  }

  function addRoom(ch,bx,by,w,h,r){
    const rm = { id: ch.rooms.length, tiles:[] };
    // 내부 나무 바닥
    for(let ix=1; ix<w-1; ix++)
      for(let iy=1; iy<h-1; iy++){
        const gx=bx+ix, gy=by+iy, k=K(gx,gy);
        ch.woodFloors.add(k);
        rm.tiles.push(G2P(gx,gy));
      }
    // 벽
    for(let ix=0; ix<w; ix++)
      for(let iy=0; iy<h; iy++){
        if(ix===0||iy===0||ix===w-1||iy===h-1){
          const gx=bx+ix, gy=by+iy, k=K(gx,gy);
          ch.walls.add(k); ch.solid.add(k);
        }
      }
    const doors = 1 + (r()<.4?1:0);
    for(let i=0;i<doors;i++) placeDoor(ch,bx,by,w,h,r);
    ch.rooms.push(rm);
  }

  // 겹치는 벽 정리(일부 제거/문 생성)
  function postOverlap(ch){
    const marks = new Map();
    for(const k of ch.walls){
      const [gx,gy] = k.split('|').map(Number);
      const L=K(gx-1,gy), R=K(gx+1,gy), U=K(gx,gy-1), D=K(gx,gy+1);
      const lf=ch.woodFloors.has(L), rf=ch.woodFloors.has(R), uf=ch.woodFloors.has(U), df=ch.woodFloors.has(D);
      if (lf && rf) {
        const g='v|'+gx; if(!marks.has(g)) marks.set(g,[]); marks.get(g).push({gx,gy,dir:'v'});
      } else if (uf && df) {
        const g='h|'+gy; if(!marks.has(g)) marks.set(g,[]); marks.get(g).push({gx,gy,dir:'h'});
      }
    }
    if (marks.size===0) return;
    const rm = new Set(), mk=[];
    for(const [g,arr] of marks){
      arr.sort((a,b)=>a.dir==='v'?a.gy-b.gy:a.gx-b.gx);
      const r=sRng(ch.cx, ch.cy);
      if(r()<.55){ for(const t of arr) rm.add(K(t.gx,t.gy)); }
      else {
        const n=arr.length, dn=Math.min(2,Math.max(1,Math.floor(n/6)));
        const pick=new Set(); 
        for(let i=0;i<dn;i++){ let idx=(Math.floor(r()*n)); let gd=0; while(pick.has(idx)&&gd<8){ idx=(idx+1)%n; gd++; } pick.add(idx); }
        let i=0; for(const t of arr){ if(pick.has(i)) mk.push(t); i++; }
      }
    }
    if (rm.size>0||mk.length>0){
      for(const kk of rm){ ch.walls.delete(kk); ch.solid.delete(kk); }
      for(const t of mk){
        const k=K(t.gx,t.gy);
        if(ch.doors.has(k)) continue;
        if(ch.walls.has(k)){ ch.walls.delete(k); ch.solid.delete(k); }
        ch.doors.set(k,{ x:t.gx*TILE, y:t.gy*TILE, open:false, dir:t.dir });
      }
    }
  }

  // 컨테이너 스폰 (실내 위주 + 실외도 소폭)
  function spawnContainers(ch, r, gx0, gy0){
    const used = new Set();
    const place = (gx,gy)=>{ const k=K(gx,gy); if(used.has(k)) return false; used.add(k); return true; };
    const inRoom = (gx,gy)=> ch.woodFloors.has(K(gx,gy));

    function many(kind, count, onlyInside=false){
      let p=0, guard=0;
      while(p<count && guard<count*120){
        guard++;
        const gx = RI(r, gx0+2, gx0+CT-3);
        const gy = RI(r, gy0+2, gy0+CT-3);
        if (onlyInside && !inRoom(gx,gy)) continue;
        if (ch.walls.has(K(gx,gy)) || ch.solid.has(K(gx,gy))) continue;
        if (!place(gx,gy)) continue;
        ch.cont.push({ type:kind, x:gx*TILE, y:gy*TILE, w:1, h:1, loot:null, opened:false, solid:false });
        p++;
      }
    }
    many('box',   RI(r,2,5), true);
    many('barrel',RI(r,2,4), false);
    many('scrap', RI(r,2,4), false);
  }

  // 시작 지점 보장 스폰
  function forceStarterContainers(ch){
    const kinds = ['box','barrel','scrap'];
    let i=0;
    const around = [[2,0],[0,2],[-2,0],[0,-2],[3,3],[-3,-2]];
    for (const off of around){
      const gx = Math.round(S.p.x / TILE) + off[0];
      const gy = Math.round(S.p.y / TILE) + off[1];
      ch.cont.push({ type:kinds[i%3], x:gx*TILE, y:gy*TILE, w:1, h:1, loot:null, opened:false, solid:false });
      i++;
    }
  }

  function ensureVisibleChunks(){
    const vw = canvas.width / DPR;
    const vh = canvas.height / DPR;
    const x0=S.cam.x, y0=S.cam.y, x1=x0+vw, y1=y0+vh;
    const c0=W2C(x0,y0), c1=W2C(x1,y1);
    const minCx=Math.min(c0.cx,c1.cx)-1, maxCx=Math.max(c0.cx,c1.cx)+1;
    const minCy=Math.min(c0.cy,c1.cy)-1, maxCy=Math.max(c0.cy,c1.cy)+1;
    for(let cy=minCy; cy<=maxCy; cy++)
      for(let cx=minCx; cx<=maxCx; cx++){
        if(!getChunk(cx,cy)) setChunk(cx,cy, genChunk(cx,cy));
      }
  }

  // === Collision / Inside ===
  function isSolidAt(x,y){
    const {gx,gy}=P2G(x,y);
    const {cx,cy}=W2C(x,y);
    for(let yy=cy-1; yy<=cy+1; yy++)
      for(let xx=cx-1; xx<=cx+1; xx++){
        const ch=getChunk(xx,yy); if(!ch) continue;
        const k=K(gx,gy);
        if(ch.solid.has(k)){
          const d=ch.doors.get(k);
          if(d && d.open) continue;
          return true;
        }
      }
    return false;
  }

  function insideRoomAt(x,y){
    const {cx,cy}=W2C(x,y);
    for(let yy=cy-1; yy<=cy+1; yy++)
      for(let xx=cx-1; xx<=cx+1; xx++){
        const ch=getChunk(xx,yy); if(!ch) continue;
        for(const rm of ch.rooms){
          for(const t of rm.tiles){
            if (Math.abs(x - t.x) < TILE/2 && Math.abs(y - t.y) < TILE/2) return rm;
          }
        }
      }
    return null;
  }

  // === Interactions (E) ===
  let eReady = true;
  w.addEventListener('keydown', e=>{
    const k = e.key.toLowerCase();
    if (k==='e') { if (eReady) interact(); eReady=false; }
    if (k==='escape' && S.uiLoot) { S.uiLoot=false; lootEl.style.display='none'; }
  });
  w.addEventListener('keyup', e=>{ if(e.key.toLowerCase()==='e') eReady=true; });

  function nearestDoor(x,y,rad){
    let best=null, bd=1e9;
    const {cx,cy}=W2C(x,y);
    for(let yy=cy-1; yy<=cy+1; yy++)
      for(let xx=cx-1; xx<=cx+1; xx++){
        const ch=getChunk(xx,yy); if(!ch) continue;
        for(const [kk,d] of ch.doors){
          const dd=Math.hypot(d.x-x, d.y-y);
          if(dd<rad && dd<bd){ best=d; bd=dd; }
        }
      }
    return best;
  }

  function nearestContainer(x,y,rad){
    let best=null, bd=1e9;
    const {cx,cy}=W2C(x,y);
    for(let yy=cy-1; yy<=cy+1; yy++)
      for(let xx=cx-1; xx<=cx+1; xx++){
        const ch=getChunk(xx,yy); if(!ch) continue;
        for(const c of ch.cont){
          const cxp=c.x - TILE/2 + (c.w*TILE)/2;
          const cyp=c.y - TILE/2 + (c.h*TILE)/2;
          const dd=Math.hypot(cxp-x, cyp-y);
          if(dd<rad && dd<bd){ best=c; bd=dd; }
        }
      }
    return best;
  }

  function interact(){
    if (S.uiLoot) return;
    const d0 = nearestDoor(S.p.x,S.p.y, 20);
    if (d0) { d0.open = !d0.open; return; }
    const c  = nearestContainer(S.p.x,S.p.y, 20);
    if (c) { openLoot(c); return; }
  }

  // === Inventory / Loot ===
  const ICON = { wood:'🪵', scrap:'🔩', food:'🥫' };
  const NAME = { wood:'목재', scrap:'고철', food:'식량' };

  function updInvUI(){
    uiInv.innerHTML = '';
    const cap = d.createElement('div');
    cap.style.cssText = 'background:#141922cc;border:1px solid #2b2f39;border-radius:8px;padding:4px 8px';
    cap.textContent = `소지 ${S.p.carry}/${S.p.cap}`;
    uiInv.appendChild(cap);
    ['wood','scrap','food'].forEach(k=>{
      const el = d.createElement('div');
      el.style.cssText = 'background:#141922cc;border:1px solid #2b2f39;border-radius:8px;padding:4px 8px';
      el.textContent = `${ICON[k]} ${NAME[k]} ${S.inv[k]}`;
      uiInv.appendChild(el);
    });
    capEl.textContent = `${S.p.carry}/${S.p.cap}`;
  }
  updInvUI();

  function rollLoot(c){
    if (c.loot) return;
    const r = rng;
    const loot = { wood:0, scrap:0, food:0 };
    if (c.type==='box')   { loot.wood = RI(r,2,6); loot.food = RI(r,0,2); if(r()<.25) loot.scrap += RI(r,1,2); }
    if (c.type==='barrel'){ loot.scrap = RI(r,2,6); if(r()<.2) loot.food += 1; }
    if (c.type==='scrap') { loot.scrap = RI(r,3,8); if(r()<.15) loot.wood += 1; }
    c.loot = loot;
  }
  function openLoot(c){
    rollLoot(c);
    S.uiLoot = true;
    S.openedCont = c;
    lootEl.style.display = 'block';
    lootT.textContent = '루팅 — ' + ({box:'상자', barrel:'드럼통', scrap:'고철더미'}[c.type]||'');
    renderLoot(c);
  }
  function renderLoot(c){
    lootG.innerHTML = '';
    let empty = true;
    ['wood','scrap','food'].forEach(k=>{
      const q = c.loot[k]||0;
      if (q>0){ empty=false;
        const nm = d.createElement('div'); nm.textContent = `${ICON[k]} ${NAME[k]}`;
        const qt = d.createElement('div'); qt.textContent = 'x'+q;
        const b1 = d.createElement('button'); b1.textContent='1개'; b1.onclick=()=>take(c,k,1);
        const b2 = d.createElement('button'); b2.textContent='모두'; b2.onclick=()=>take(c,k,q);
        lootG.append(nm,qt,b1,b2);
      }
    });
    if (empty){
      const cell = d.createElement('div');
      cell.style.gridColumn='1 / span 4';
      cell.textContent='비어 있음';
      lootG.appendChild(cell);
    }
    capEl.textContent = `${S.p.carry}/${S.p.cap}`;
  }
  function addInv(k, q){
    const room = Math.max(0, S.p.cap - S.p.carry);
    const take = Math.min(room, q);
    if (take<=0) return 0;
    S.inv[k] += take;
    S.p.carry += take;
    updInvUI();
    return take;
  }
  function take(c,k,q){
    const have = c.loot[k]||0;
    if (have<=0) return;
    const t = addInv(k, Math.min(q, have));
    c.loot[k] = have - t;
    renderLoot(c);
  }
  function takeAll(c){
    if (!c) return;
    ['wood','scrap','food'].forEach(k=>{
      const have = c.loot[k]||0;
      if (have>0) {
        const t = addInv(k, have);
        c.loot[k] = have - t;
      }
    });
    renderLoot(c);
  }

  // === Movement / Camera ===
  function move(dt){
    if (S.uiLoot) return; // 루팅창 열려있으면 이동 정지
    let ix=0, iy=0;
    if (key['w']||key['arrowup'])    iy-=1;
    if (key['s']||key['arrowdown'])  iy+=1;
    if (key['a']||key['arrowleft'])  ix-=1;
    if (key['d']||key['arrowright']) ix+=1;
    const L=Math.hypot(ix,iy)||1; ix/=L; iy/=L;
    S.p.vx = ix*(S.p.spd*60);
    S.p.vy = iy*(S.p.spd*60);
    if (Math.hypot(S.p.vx,S.p.vy)>0.1){ S.p.ldx=ix; S.p.ldy=iy; }

    const nx = S.p.x + S.p.vx*dt;
    const ny = S.p.y + S.p.vy*dt;
    if (isSolidAt(nx,ny)) {
      const tx = S.p.x + S.p.vx*dt;
      if(!isSolidAt(tx,S.p.y)) S.p.x=tx; else S.p.vx=0;
      const ty = S.p.y + S.p.vy*dt;
      if(!isSolidAt(S.p.x,ty)) S.p.y=ty; else S.p.vy=0;
    } else { S.p.x=nx; S.p.y=ny; }
  }

  function updateCam(dt){
    const vw=canvas.width / DPR, vh=canvas.height / DPR;
    const tx = S.p.x - vw/2, ty = S.p.y - vh/2;
    S.cam.x += (tx - S.cam.x)*Math.min(1, dt*4);
    S.cam.y += (ty - S.cam.y)*Math.min(1, dt*4);
  }

  // === Overlay (full-res) ===
  let fx=null, fxc=null;
  function drawOverlay(camX,camY){
    if (!S.inside) return;
    if(!fx){ fx=d.createElement('canvas'); fxc=fx.getContext('2d'); }
    // 보조 캔버스를 화면과 동일 해상도로 유지 (다운스케일 제거)
    if(fx.width!==canvas.width || fx.height!==canvas.height){
      fx.width = canvas.width; fx.height = canvas.height;
    }

    // 현재 화면 복사 + 외부 채도 0.5 + 약블러
    fxc.setTransform(1,0,0,1,0,0);
    fxc.clearRect(0,0,fx.width,fx.height);
    fxc.filter='saturate(0.5) blur(1px)';
    fxc.drawImage(canvas,0,0);

    // 실내 타일 부분은 빼서(구멍) 내부는 원색 유지
    fxc.globalCompositeOperation='destination-out';
    fxc.beginPath();
    for(const t of S.inside.tiles){
      const x = Math.round((t.x - TILE/2 - camX) * DPR);
      const y = Math.round((t.y - TILE/2 - camY) * DPR);
      const s = Math.round(TILE * DPR);
      fxc.rect(x,y,s,s);
    }
    fxc.fill();
    fxc.globalCompositeOperation='source-over';

    // 알파로 페이드
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalAlpha = Math.max(0, Math.min(1, S.ovA));
    ctx.drawImage(fx,0,0);
    ctx.restore();
  }

  // === Rendering ===
  function drawBG(){
    const W=canvas.width / DPR, H=canvas.height / DPR;
    const sx=Math.floor(S.cam.x/TILE)-2, sy=Math.floor(S.cam.y/TILE)-2;
    const ex=sx+Math.ceil(W/TILE)+4,    ey=sy+Math.ceil(H/TILE)+4;
    for(let gx=sx;gx<ex;gx++) for(let gy=sy;gy<ey;gy++){
      const v=Math.abs((gx*374761393+gy*668265263)%255);
      // 약간 연한 초록
      ctx.fillStyle=`rgb(${22+(v%10)},${36+(v%14)},${24+(v%12)})`;
      ctx.fillRect(gx*TILE,gy*TILE,TILE,TILE);
    }
  }
  function drawFloors(){
    forEachVisibleChunk(ch=>{
      for(const k of ch.woodFloors){
        const [gx,gy]=k.split('|').map(Number);
        ctx.fillStyle='#3a2f21';
        ctx.fillRect(gx*TILE-TILE/2, gy*TILE-TILE/2, TILE, TILE);
      }
      for(const k of ch.floors){
        const [gx,gy]=k.split('|').map(Number);
        ctx.fillStyle='#1c2130';
        ctx.fillRect(gx*TILE-TILE/2, gy*TILE-TILE/2, TILE, TILE);
      }
    });
  }
  function drawWalls(){
    forEachVisibleChunk(ch=>{
      const has=(gx,gy)=>ch.walls.has(K(gx,gy));
      for(const k of ch.walls){
        const [gx,gy]=k.split('|').map(Number), x=gx*TILE, y=gy*TILE;
        ctx.fillStyle='#384050'; ctx.fillRect(x-TILE/2,y-TILE/2,TILE,TILE);
        // 인접 벽끼리 경계선 제거
        ctx.strokeStyle='#2b2f39'; ctx.beginPath();
        if(!has(gx,gy-1)){ ctx.moveTo(x-TILE/2+0.5,y-TILE/2+0.5); ctx.lineTo(x+TILE/2-0.5,y-TILE/2+0.5); }
        if(!has(gx+1,gy)){ ctx.moveTo(x+TILE/2-0.5,y-TILE/2+0.5); ctx.lineTo(x+TILE/2-0.5,y+TILE/2-0.5); }
        if(!has(gx,gy+1)){ ctx.moveTo(x-TILE/2+0.5,y+TILE/2-0.5); ctx.lineTo(x+TILE/2-0.5,y+TILE/2-0.5); }
        if(!has(gx-1,gy)){ ctx.moveTo(x-TILE/2+0.5,y-TILE/2+0.5); ctx.lineTo(x-TILE/2+0.5,y+TILE/2-0.5); }
        ctx.stroke();
      }
      // 문
      for(const [kk,dv] of ch.doors){
        const x=dv.x, y=dv.y;
        if(dv.open){ ctx.fillStyle='#8b9ab0'; ctx.fillRect(x-TILE/2+2,y-TILE/2+2, TILE-4, TILE-4); }
        else{
          ctx.fillStyle='#384050'; ctx.fillRect(x-TILE/2, y-TILE/2, TILE, TILE);
          ctx.fillStyle='#b08a55';
          if(dv.dir==='h') ctx.fillRect(x-TILE/2+2,y-1,TILE-4,2);
          else             ctx.fillRect(x-1,y-TILE/2+2,2,TILE-4);
        }
      }
    });
  }
  function drawContainers(){
    forEachVisibleChunk(ch=>{
      for(const c of ch.cont){
        const x=c.x - TILE/2, y=c.y - TILE/2;
        if(c.type==='box'){
          ctx.fillStyle='#5a432a'; ctx.fillRect(x,y,TILE,TILE);
          ctx.strokeStyle='#b48c58'; ctx.strokeRect(x+0.5,y+0.5,TILE-1,TILE-1);
        } else if(c.type==='barrel'){
          ctx.fillStyle='#444c55'; ctx.fillRect(x+2,y,12,TILE);
          ctx.fillStyle='#8aa3b5'; ctx.fillRect(x+2,y+3,12,2); ctx.fillRect(x+2,y+TILE-5,12,2);
        } else if(c.type==='scrap'){
          ctx.fillStyle='#4b5560'; ctx.fillRect(x+3,y+6,10,6);
        }
        // 다 비운 컨테이너는 약간 흐리게
        if(c.loot && (c.loot.wood|0)+(c.loot.scrap|0)+(c.loot.food|0)===0){
          ctx.globalAlpha=.45; ctx.fillStyle='rgba(0,0,0,.15)';
          ctx.fillRect(x,y,TILE,TILE); ctx.globalAlpha=1;
        }
      }
    });
  }
  function drawPlayer(){
    const p=S.p;
    ctx.fillStyle='rgba(0,0,0,.25)'; ctx.beginPath(); ctx.arc(p.x,p.y+4,7,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#cfd1d6'; ctx.fillRect(p.x-6,p.y-10,12,12);
    ctx.fillStyle='#4e566a'; ctx.fillRect(p.x-6,p.y+2,12,6);
  }

  function forEachVisibleChunk(f){
    const vw=canvas.width / DPR, vh=canvas.height / DPR;
    const x0=S.cam.x, y0=S.cam.y, x1=x0+vw, y1=y0+vh;
    const c0=W2C(x0,y0), c1=W2C(x1,y1);
    const minCx=Math.min(c0.cx,c1.cx)-1, maxCx=Math.max(c0.cx,c1.cx)+1;
    const minCy=Math.min(c0.cy,c1.cy)-1, maxCy=Math.max(c0.cy,c1.cy)+1;
    for(let cy=minCy;cy<=maxCy;cy++)
      for(let cx=minCx;cx<=maxCx;cx++){
        let ch=getChunk(cx,cy); if(!ch){ ch=genChunk(cx,cy); setChunk(cx,cy,ch); }
        f(ch);
      }
  }

  // === Loop ===
  let last=performance.now();
  function loop(now){
    const dt = Math.min(.05, (now-last)/1000); last=now;
    S.time += dt; const m=Math.floor(S.time/60), s=Math.floor(S.time%60);
    uiTime.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

    ensureVisibleChunks();
    move(dt);
    updateCam(dt);

    const wasInside = !!S.inside;
    S.inside = insideRoomAt(S.p.x,S.p.y);
    if (!wasInside && S.inside) S.ovA = 0;                // 입장: 0부터
    if ( S.inside) {
      const rate = 1/Math.max(0.0001, S.fadeInSec);       // 2초 페이드
      S.ovA = Math.min(1, S.ovA + rate*dt);
    } else {
      S.ovA = 0;                                          // 퇴장: 즉시 해제
    }

    // 힌트(문/컨테이너)
    const nearDoor = !!nearestDoor(S.p.x,S.p.y,20);
    const nearCont = !!nearestContainer(S.p.x,S.p.y,20);
    S.nearPrompt   = nearDoor || nearCont;
    hintEl.style.display = S.nearPrompt ? 'block' : 'none';
    hintEl.textContent = nearDoor ? 'E 문 여닫기' : (nearCont ? 'E 루팅' : 'E 상호작용');

    // === draw ===
    ctx.save();
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.scale(DPR, DPR);
    const camX=Math.round(S.cam.x), camY=Math.round(S.cam.y);
    ctx.translate(-camX, -camY);

    drawBG();
    drawFloors();
    drawWalls();
    drawContainers();
    drawPlayer();

    // 실내 덮개 — "현재 들어간 방만 제외" (중요: return이 아니라 continue!)
    const cover = '#384050';
    forEachVisibleChunk(ch=>{
      for(const rm of ch.rooms){
        if (S.inside && rm === S.inside) continue; // ← 버그 수정 포인트
        for(const t of rm.tiles){
          ctx.fillStyle=cover;
          ctx.fillRect(t.x - TILE/2, t.y - TILE/2, TILE, TILE);
        }
      }
    });

    drawOverlay(camX,camY);
    ctx.restore();

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
