const {check}=require('./engine');
const manifest=require('./manifest');
const files={admin:'admin.html', server:'functions/index.js', site:'index.html'};
check(files,manifest).forEach(r=>{
  const red=r.rows.filter(x=>!x.found).length;
  console.log('\n=== '+r.spine.field+'  ('+(red?red+' RED':'all green')+') ===');
  r.rows.forEach(x=>console.log('  '+(x.found?'GREEN':'RED  ')+'  '+x.side.padEnd(5)+' '+(x.where||'').padEnd(38)+(x.why?' ← '+x.why:'')));
  console.log('  amber (undeclared) — '+r.undeclared.length+':');
  r.undeclared.forEach(u=>console.log('      '+u));
});
