import * as XLSX from "xlsx";

/**
 * Generate and download a sample Excel file for Channel Partner User Import
 */
export const downloadUserImportSample = () => {
  const data = [
    {
      "Customer Name": "Abir Hasan",
      "Receive Amount": 630,
      "Not Paid": 0,
    },
    {
      "Customer Name": "Sabbir Ahmed",
      "Receive Amount": 0,
      "Not Paid": 630,
    },
    {
      "Customer Name": "Kamal Hossain",
      "Receive Amount": 400,
      "Not Paid": 230,
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "User Collection");

  // Set column widths
  const wscols = [
    { wch: 30 }, // Customer Name
    { wch: 15 }, // Receive Amount
    { wch: 15 }, // Not Paid
  ];
  worksheet["!cols"] = wscols;

  XLSX.writeFile(workbook, "channel_user_import_sample.xlsx");
};

/**
 * Generate and download a sample Excel file for Partner Advances Import
 */
export const downloadAdvanceImportSample = () => {
  const data = [
    {
      "User Name": "Abir Hasan",
      "Advance Amount": 1000,
      "Advance Type": "direct_payment",
      Notes: "Paid to partner for equipment",
    },
    {
      "User Name": "Sabbir Ahmed",
      "Advance Amount": 500,
      "Advance Type": "adjustment",
      Notes: "Previous month adjustment",
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Partner Advances");

  // Set column widths
  const wscols = [
    { wch: 30 }, // User Name
    { wch: 15 }, // Advance Amount
    { wch: 20 }, // Advance Type
    { wch: 40 }, // Notes
  ];
  worksheet["!cols"] = wscols;

  XLSX.writeFile(workbook, "partner_advances_sample.xlsx");
};

/**
 * Generate and download a sample Excel file for Product Catalog Import
 */
export const downloadProductImportSample = () => {
  const workbook = XLSX.utils.book_new();
  
  // Array of arrays representing the layout shown in user image
  const aoa = [
    ["Product", "", "", "", ""],
    ["SL", "Product Discription", "Qty", "Price", "Amount"],
    [1, "Patch Cord 1/2 Half", 1, 60, 60],
    [2, "Fiber Cable 4 Core", 100, 12, 1200]
  ];
  
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  
  // Merge A1 to E1
  worksheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }
  ];
  
  // Column widths
  worksheet["!cols"] = [
    { wch: 8 },  // SL
    { wch: 35 }, // Product Discription
    { wch: 10 }, // Qty
    { wch: 12 }, // Price
    { wch: 12 }  // Amount
  ];
  
  XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
  XLSX.writeFile(workbook, "product_import_sample.xlsx");
};
