import {simulate} from './model.mjs';
self.onmessage = ({data}) => { try {self.postMessage({ok:true,result:simulate(data.config,data.policies)});} catch(error) {self.postMessage({ok:false,error:error.message});} };
