// Regenerates prices.xlsx (kept in git so the example runs without this script).
import ExcelJS from 'exceljs';
const wb = new ExcelJS.Workbook();
const s = wb.addWorksheet('Basket');
s.addRows([
  ['product', 'qty', 'total', 'active'],
  ['apple', 6, '3.00', 'yes'],
  ['pear', 2, '1.50', 'no'],
  ['melon', 2, '6.00', 'yes'],
]);
await wb.xlsx.writeFile(new URL('./prices.xlsx', import.meta.url).pathname);
console.log('wrote prices.xlsx');
