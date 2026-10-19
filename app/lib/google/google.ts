// Shapes and formatting shared by the Google page and the server.

export type Totals = { sessions: number; users: number; purchases: number; revenue: number };
export type AdsTotals = { spend: number; clicks: number; impressions: number; conversions: number; value: number };

// Google Ads shows account ids as 123-456-7890.
export const formatCustomerId = (id: string) => id.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");
