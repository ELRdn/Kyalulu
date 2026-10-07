let hosted = false;
let owner = '';
let epoch = 0;
export const isCloud = () => hosted;
export const cloudOwner = () => owner;
export const cloudEpoch = () => epoch;
export const setCloud = (value: boolean) => { if(hosted!==value) ++epoch; hosted = value; if(!value) owner=''; };
export const setCloudOwner = (value: string) => { if(owner!==value) ++epoch; owner = value; };
