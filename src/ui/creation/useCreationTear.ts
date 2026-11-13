import type { PointerEvent } from 'react';
import { useTicketTear } from '../home/useTicketTear';

// Reuse #125's cancellation/locking. Prevent native text drag on the new form
// stub; its only action is the original HTML form's requestSubmit callback.
export function useCreationTear(identity:string,blocked:boolean,action:()=>void) {
  const tear=useTicketTear(identity,blocked,action);
  return {...tear,handlers:{...tear.handlers,onPointerDown(event:PointerEvent<HTMLElement>){
    if(event.button===0)event.preventDefault();tear.handlers.onPointerDown(event);
  }}};
}
