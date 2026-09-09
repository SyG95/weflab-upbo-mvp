const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f);
const {normalizeFanLayout,fanLayoutBlocksInSlot,POSTER_BLOCKS}=require('../lib/api.ts');
const old=normalizeFanLayout({posters:{slot:'top',order:1},reveal:{slot:'top',order:0},notice:{slot:'bottom',order:0}});
assert.deepEqual(fanLayoutBlocksInSlot(old,'top'),['reveal',...POSTER_BLOCKS]);assert.deepEqual(normalizeFanLayout(old),old);
const fresh=normalizeFanLayout({poster0:{slot:'top',order:0},poster1:{slot:'left',order:0},poster2:{slot:'right',order:0},poster3:{slot:'bottom',order:0},poster4:{slot:'bottom',order:1}});
assert.deepEqual(fanLayoutBlocksInSlot(fresh,'bottom'),['poster3','poster4']);assert.equal(normalizeFanLayout({poster4:{slot:'bad',order:NaN}}).poster4.slot,'left');
console.log('Poster layout: legacy grouping, five positions, order and validation passed');
