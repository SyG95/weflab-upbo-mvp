import {allocateDeliveryToRefs,type AggItem} from './api';
type Ref=NonNullable<AggItem['refs']>[number];
type Hint={doneCount:number;doneAt:string};
// Edit a single occurrence after allocating the full holding. Pin every other
// occurrence's allocation so changing one month cannot move another month's work.
export function editDeliveryRef(refs:Ref[],total:number,hints:Record<string,Hint>,entryId:string,requested:number,now:string){
 const allocations=allocateDeliveryToRefs(refs,total,hints);
 const index=refs.findIndex(r=>r.entryId===entryId);
 if(index<0||!Number.isFinite(requested))throw new Error('Invalid delivery occurrence');
 const count=Math.max(0,Math.min(refs[index].quantity,Math.trunc(requested)));
 const next:Record<string,Hint>={};
 refs.forEach((ref,i)=>{const n=i===index?count:allocations[i].allocated;if(n>0)next[ref.entryId]={doneCount:n,doneAt:i===index?(n===allocations[i].allocated?(hints[ref.entryId]?.doneAt??''):now):(hints[ref.entryId]?.doneAt??'')};});
 return {total:total+count-allocations[index].allocated,hints:next};
}
