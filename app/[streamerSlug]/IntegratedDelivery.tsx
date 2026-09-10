'use client';
import type {ReactNode} from 'react';
import {DeliveryEditorScope} from './DeliveryEditorScope';
import s from './FinalDelivery.module.css';
export default function IntegratedDelivery({children,month}:{children:ReactNode;month:string}){return <div className={s.root} data-refinement="ref-u"><DeliveryEditorScope.Provider value={{query:'',month,final:true,design:'ref-u'}}>{children}</DeliveryEditorScope.Provider></div>;}
