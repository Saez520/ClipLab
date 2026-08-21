import { buildApp } from './api/app.js';
const port=Number(process.env.PORT ?? 3000); if(!Number.isInteger(port)||port<1||port>65535) throw new Error('PORT must be an integer between 1 and 65535');
const app=buildApp(); app.listen({port,host:'0.0.0.0'}).catch(error=>{app.log.error(error); process.exit(1);});
