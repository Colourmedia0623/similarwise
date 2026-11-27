// Shared by the Product from photos page and its server code (listing.server.ts).

export const MAX_PHOTOS = 6;

export type Attribute = { name: string; value: string };

// The EU product safety (GPSR) details a listing should carry, as far as the
// photos and the merchant can tell.
export type Compliance = {
  manufacturer: string;
  manufacturerAddress: string;
  euResponsiblePerson: string;
  countryOfOrigin: string;
  materials: string;
  warnings: string;
  care: string;
  marks: string; // CE, UKCA, recycling and age marks seen on the pack
};

export type Category = { id: string; fullName: string };

export type Listing = {
  title: string;
  description: string; // plain paragraphs, separated by blank lines
  productType: string;
  vendor: string;
  tags: string[];
  categoryPath: string; // what Claude thinks it is, such as "Home & Garden > Decor > Candles"
  categoryId: string | null; // the Shopify taxonomy category picked for it
  attributes: Attribute[];
  seoTitle: string;
  seoDescription: string;
  compliance: Compliance;
  check: string[]; // things Claude couldn't see or is unsure of
  price: string;
};

export const COMPLIANCE_FIELDS: [keyof Compliance, string, string][] = [
  ["manufacturer", "Manufacturer", "The company that makes it"],
  [
    "manufacturerAddress",
    "Manufacturer's address",
    "Postal address, and email or website",
  ],
  [
    "euResponsiblePerson",
    "EU responsible person",
    "Needed when the maker is outside the EU",
  ],
  ["countryOfOrigin", "Country of origin", ""],
  ["materials", "Materials or ingredients", ""],
  ["warnings", "Safety warnings", "As printed on the label or pack"],
  ["care", "Care and use", ""],
  ["marks", "Marks on the pack", "Such as CE, UKCA, age or recycling marks"],
];

export const emptyCompliance = (): Compliance => ({
  manufacturer: "",
  manufacturerAddress: "",
  euResponsiblePerson: "",
  countryOfOrigin: "",
  materials: "",
  warnings: "",
  care: "",
  marks: "",
});

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// The product page's description: the merchant's paragraphs, then the
// product's details and its safety information when there are any.
export function descriptionHtml(
  l: Pick<Listing, "description" | "attributes" | "compliance">,
) {
  const paras = l.description
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`);
  const attrs = l.attributes.filter((a) => a.name.trim() && a.value.trim());
  const out = [...paras];
  if (attrs.length)
    out.push(
      `<h3>Product details</h3>`,
      `<ul>${attrs.map((a) => `<li><strong>${esc(a.name.trim())}:</strong> ${esc(a.value.trim())}</li>`).join("")}</ul>`,
    );
  const safety = COMPLIANCE_FIELDS.filter(([k]) => l.compliance[k].trim());
  if (safety.length)
    out.push(
      `<h3>Safety and product information</h3>`,
      `<ul>${safety.map(([k, label]) => `<li><strong>${esc(label)}:</strong> ${esc(l.compliance[k].trim()).replace(/\n/g, "<br>")}</li>`).join("")}</ul>`,
    );
  return out.join("\n");
}

// What EU safety rules expect on a listing that's still empty.
export function missingCompliance(c: Compliance) {
  return (["manufacturer", "manufacturerAddress", "warnings"] as const)
    .filter((k) => !c[k].trim())
    .map((k) => COMPLIANCE_FIELDS.find(([f]) => f === k)![1]);
}
