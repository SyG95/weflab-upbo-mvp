'use client';
import {createContext,useContext} from 'react';
export const DeliveryEditorScope=createContext<{query:string;month:string;onDirty?:(dirty:boolean)=>void;final?:boolean;design?:string}|null>(null);
export const useDeliveryEditorScope=()=>useContext(DeliveryEditorScope);
