
/**
 * Encounter+ Importer - Last charge destruction automation (Foundry V13 + dnd5e).
 * Items flagged with flags["encounterplus-importer"].destroyOnLastCharge=true will:
 *  - when charges are fully spent (spent reaches max), roll 1d20
 *  - on 1, delete the item from the actor inventory
 */
const MOD="encounterplus-importer";
const pending=new Map();

function n(v, d=0){ const x=Number(v); return Number.isFinite(x)?x:d; }

Hooks.on("preUpdateItem",(item, changes)=>{
  try{
    const actor=item?.parent;
    if(!actor || actor.documentName!=="Actor") return;
    if(!item?.flags?.[MOD]?.destroyOnLastCharge) return;

    const oldSpent=n(item.system?.uses?.spent,0);
    const oldMax=n(item.system?.uses?.max,0);

    const newSpent=changes?.system?.uses?.spent!==undefined ? n(changes.system.uses.spent, oldSpent) : oldSpent;
    const newMax  =changes?.system?.uses?.max  !==undefined ? n(changes.system.uses.max, oldMax)   : oldMax;

    if(newMax>0 && newSpent>=newMax && oldSpent<newMax && newSpent>oldSpent){
      pending.set(item.uuid, true);
    }
  }catch(e){ console.error(`${MOD} | lastcharge preUpdateItem`, e); }
});

Hooks.on("updateItem", async (item)=>{
  try{
    const actor=item?.parent;
    if(!actor || actor.documentName!=="Actor") return;
    if(!pending.get(item.uuid)) return;
    pending.delete(item.uuid);

    const spent=n(item.system?.uses?.spent,0);
    const max=n(item.system?.uses?.max,0);
    if(!(max>0 && spent>=max)) return;

    const roll=await (new Roll("1d20")).roll({async:true});
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({actor}),
      flavor: `${item.name} — Dernière charge dépensée : test de destruction (sur 1)`
    });

    if(roll.total===1){
      const name=item.name;
      await item.delete();
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({actor}),
        content: `<p><strong>${name}</strong> est détruit et tombe en poussière.</p>`
      });
    }
  }catch(e){ console.error(`${MOD} | lastcharge updateItem`, e); }
});
