const DATA=window.CATALOGO||[];
const grid=document.getElementById('grid'),catsEl=document.getElementById('cats'),
 q=document.getElementById('q'),countEl=document.getElementById('count'),empty=document.getElementById('empty');
let cat='Todos',term='';
const cats=['Todos',...Array.from(new Set(DATA.map(d=>d.cat)))];
const brl=v=>'R$ '+(Number(v||0).toFixed(2)).replace('.',',');
function norm(s){return (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')}
function renderChips(){catsEl.innerHTML=cats.map(c=>{
 const n=c==='Todos'?DATA.length:DATA.filter(d=>d.cat===c).length;
 return `<button class="chip ${c===cat?'on':''}" data-c="${c}">${c} <b>${n}</b></button>`}).join('');
 catsEl.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{cat=b.dataset.c;renderChips();render()});}
function render(){
 const t=norm(term);
 const list=DATA.filter(d=>(cat==='Todos'||d.cat===cat)&&
   (!t||norm(d.nome).includes(t)||d.codigo.includes(term.trim())));
 countEl.textContent=`${list.length} produto(s)`+(cat!=='Todos'?` em ${cat}`:'');
 empty.hidden=list.length>0;
 grid.innerHTML=list.map((d,i)=>`<article class="card" data-i="${DATA.indexOf(d)}">
   <div class="thumb"><img loading="lazy" src="${d.img}" alt="${d.nome}">
   ${d.temfoto?'':'<span class="nofoto">sem foto</span>'}</div>
   <div class="cbody"><div class="cname">${d.nome}</div>
   <div class="cmeta"><span class="tag">Cód. ${d.codigo}</span>${d.cor?'<span class="tag">'+d.cor+'</span>':''}${d.med?'<span class="tag">'+d.med.replace(/X/g,'×')+'</span>':''}</div>
   <div class="cprice">${brl(d.preco)}</div></div></article>`).join('');
 grid.querySelectorAll('.card').forEach(c=>c.onclick=()=>openModal(DATA[c.dataset.i]));}
const modal=document.getElementById('modal');
function openModal(d){document.getElementById('mimg').src=d.img;
 document.getElementById('mname').textContent=d.nome;
 document.getElementById('mcod').textContent='Código '+d.codigo+'  •  '+d.cat;
 document.getElementById('mdesc').textContent=d.desc||'';
 document.getElementById('mprice').textContent=brl(d.preco);modal.hidden=false;}
document.getElementById('x').onclick=()=>modal.hidden=true;
modal.onclick=e=>{if(e.target===modal)modal.hidden=true};
q.addEventListener('input',()=>{term=q.value;render()});
renderChips();render();