// Simulación visual únicamente. No genera ni reclama recompensas reales.
function chooseTreeReward(draw,u,g) {
  const rewards=[["XP",10,3500],["XP",25,5000],["XP",50,5700],["XP",100,5950],["XP",200,6000],["GCOIN",10,8500],["GCOIN",25,9500],["GCOIN",100,9700],["VBUCKS",100,9900],["VBUCKS",500,9980],["VBUCKS",1000,10000]];
  if(!Number.isInteger(draw)||draw<0||draw>=10000)throw Error("invalid draw");
  const [reward,amount]=rewards.find(r=>draw<r[2]);
  const ok=reward==="XP"?u.xp+amount<=400&&g.xp+amount<=23200:reward==="GCOIN"?u.gc+amount<=250&&g.gc+amount<=6000:u.vb===0&&g.vb+amount<=3000&&(g.stock[amount]||0)<({100:10,500:2,1000:1}[amount]);
  if(ok)return {reward,amount};
  if(u.xp+10<=400&&g.xp+10<=23200)return {reward:"XP",amount:10};
  if(u.gc+10<=250&&g.gc+10<=6000)return {reward:"GCOIN",amount:10};
  return {reward:"SOUVENIR",amount:0};
}
function addTreeReward(r,u,g){
  if(r.reward==="XP"){u.xp+=r.amount;g.xp+=r.amount;}
  else if(r.reward==="GCOIN"){u.gc+=r.amount;g.gc+=r.amount;}
  else if(r.reward==="VBUCKS"){u.vb+=r.amount;g.vb+=r.amount;g.stock[r.amount]=(g.stock[r.amount]||0)+1;}
}
window.GAChristmasTreeDemo={chooseTreeReward,addTreeReward};
