import {integer} from '../validation.mjs';
import {GROWTH_CATEGORIES} from '../growthCatalog.mjs';
import {LOCAL_PROFILE_ID} from '../contracts/userContext.mjs';

const dateKey = (date,timeZone) => {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const part=type=>parts.find(p=>p.type===type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const shift=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const monday=day=>shift(day,-((new Date(day+'T00:00:00Z').getUTCDay()+6)%7));

/** Reporting uses persisted awardDay, just like frequency checks and the existing summary.
 * Historical days are NOT relabelled when the family changes its time zone.
 * Only valid classified earn/observation records participate; gifts/purchases and
 * superseded corrections cannot masquerade as positive growth activity.
 */
export function createGrowthSummary({repo,profile,clock=()=>new Date()}) {
  return function summary({days=7}={}) {
    integer(days,'统计天数',1,365);
    const p=profile(),timeZone=p?.timeZone??'UTC';
    const today=dateKey(clock(),timeZone),since=shift(today,1-days);
    const categoryStats=GROWTH_CATEGORIES.map(c=>({category:c.id,count:0,points:0}));
    const categories=new Map(categoryStats.map(c=>[c.category,c]));
    const dailyStats=Array.from({length:days},(_,i)=>({day:shift(since,i),count:0,points:0}));
    const dates=new Map(dailyStats.map(d=>[d.day,d]));
    for(const row of repo.dailySummary(since,today)) {
      const category=categories.get(row.category),day=dates.get(row.day);
      if(!category||!day)continue;
      category.count+=row.count;category.points+=row.points;
      day.count+=row.count;day.points+=row.points;
    }
    const weeks=new Map();
    for(const day of dailyStats){
      const start=monday(day.day);
      if(!weeks.has(start))weeks.set(start,{weekStart:start,from:day.day,to:day.day,count:0,points:0});
      const week=weeks.get(start);week.to=day.day;week.count+=day.count;week.points+=day.points;
    }
    const account=repo.account();
    return {schemaVersion:1,profileId:LOCAL_PROFILE_ID,configured:!!p,timeZone,
      period:{days,since,today,dateBasis:'persisted-award-day'},
      balance:account.balance,lifetimePoints:account.lifetime,
      periodPoints:dailyStats.reduce((n,d)=>n+d.points,0),
      periodCount:dailyStats.reduce((n,d)=>n+d.count,0),
      categoryStats,dailyStats,weeklyStats:[...weeks.values()],
      unclassifiedCount:repo.unclassifiedCount().n,version:repo.version().version};
  };
}
