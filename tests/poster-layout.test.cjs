const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f);
const {normalizeFanLayout,fanLayoutBlocksInSlot,mobileLonePosters,POSTER_BLOCKS}=require('../lib/api.ts');
const old=normalizeFanLayout({posters:{slot:'top',order:1},reveal:{slot:'top',order:0},notice:{slot:'bottom',order:0}});
assert.deepEqual(fanLayoutBlocksInSlot(old,'top'),['reveal',...POSTER_BLOCKS]);assert.deepEqual(normalizeFanLayout(old),old);
const fresh=normalizeFanLayout({poster0:{slot:'top',order:0},poster1:{slot:'left',order:0},poster2:{slot:'right',order:0},poster3:{slot:'bottom',order:0},poster4:{slot:'bottom',order:1}});
assert.deepEqual(fanLayoutBlocksInSlot(fresh,'bottom'),['poster3','poster4']);assert.equal(normalizeFanLayout({poster4:{slot:'bad',order:NaN}}).poster4.slot,'left');
// 양옆 맨 위부터=기본. 옛 railsAtHead 는 무시, railsBelowTop 만 예전 방식으로 되돌린다.
assert.equal(normalizeFanLayout({}).railsBelowTop,false);assert.equal(normalizeFanLayout({railsAtHead:false}).railsBelowTop,false);
assert.equal(normalizeFanLayout({railsAtHead:true}).railsBelowTop,false);assert.equal(normalizeFanLayout({railsBelowTop:true}).railsBelowTop,true);
assert.equal(normalizeFanLayout({railsBelowTop:'yes'}).railsBelowTop,false);assert.equal('railsAtHead' in normalizeFanLayout({railsAtHead:true}),false);
// 모바일 2열 홀로 남는 포스터: 연속 묶음이 홀수면 마지막 한 장, 공지·확률표가 묶음을 끊는다.
assert.deepEqual(mobileLonePosters(['poster0']),{poster0:'solo'});
assert.deepEqual(mobileLonePosters(['poster0','poster1']),{});
assert.deepEqual(mobileLonePosters(['poster0','poster1','poster2']),{poster2:'orphan'});
assert.deepEqual(mobileLonePosters(['notice','poster0','poster1','poster2']),{poster2:'orphan'});
assert.deepEqual(mobileLonePosters(['poster0','notice','poster1']),{poster0:'solo',poster1:'solo'});
assert.deepEqual(mobileLonePosters(['poster0','poster1','reveal','poster2','poster3','poster4','notice']),{poster4:'orphan'});
assert.deepEqual(mobileLonePosters(['notice','reveal']),{});
console.log('Poster layout: legacy grouping, five positions, order and validation passed');
