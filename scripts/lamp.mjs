import { createLampCodes } from '../src/access.mjs';

const days = Number(process.argv[2] || 30);
const count = Number(process.argv[3] || 1);
const codes = createLampCodes(days, count);

console.log(`生成了 ${codes.length} 个 ${days} 天灯油码：`);
for (const code of codes) console.log(code);
console.log('\n每个码只能给一个人用一次。');
