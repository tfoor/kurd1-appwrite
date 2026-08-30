require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const sdk = require("node-appwrite");

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,

  APPWRITE_ENDPOINT = "https://fra.cloud.appwrite.io/v1",
  APPWRITE_PROJECT_ID,
  APPWRITE_API_KEY,

  APPWRITE_DATABASE_ID = "6a93224c002e35f858b8",
  APPWRITE_TABLE_ID = "Products",
} = process.env;

const supabaseKey =
  SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL غير موجود");
}

if (!supabaseKey) {
  throw new Error(
    "SUPABASE_ANON_KEY أو SUPABASE_SERVICE_ROLE_KEY غير موجود"
  );
}

if (!APPWRITE_PROJECT_ID) {
  throw new Error("APPWRITE_PROJECT_ID غير موجود");
}

if (!APPWRITE_API_KEY) {
  throw new Error("APPWRITE_API_KEY غير موجود");
}

const supabase = createClient(
  SUPABASE_URL,
  supabaseKey
);

const client = new sdk.Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const tablesDB = new sdk.TablesDB(client);

async function getAllProducts() {
  let from = 0;
  const step = 500;
  const all = [];

  while (true) {
    const to = from + step - 1;

    const { data, error } = await supabase
      .from("products")
      .select(
        "id,name,cat,sub,price,old_price,color,badge,img,new_until,sale"
      )
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(
        "فشل قراءة المنتجات من Supabase: " +
          error.message
      );
    }

    if (!data || data.length === 0) {
      break;
    }

    all.push(...data);

    if (data.length < step) {
      break;
    }

    from += step;
  }

  return all;
}

function cleanText(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  return String(value);
}

function cleanNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

function convertProduct(product) {
  const productId = Number(product.id);
  const price = cleanNumber(product.price);
  const oldPrice = cleanNumber(product.old_price);

  if (!Number.isInteger(productId) || productId <= 0) {
    throw new Error(
      `رقم المنتج غير صالح: ${product.id}`
    );
  }

  if (price === null) {
    throw new Error(
      `سعر المنتج ${productId} غير صالح`
    );
  }

  return {
    rowId: String(productId),

    data: {
      product_id: productId,

      name: String(product.name || ""),

      price,

      old_price: oldPrice,

      category: cleanText(product.cat),

      subcategory: cleanText(product.sub),

      color: cleanText(product.color),

      badge: cleanText(product.badge),

      image: cleanText(product.img),

      new_until: product.new_until
        ? new Date(product.new_until).toISOString()
        : null,

      sale: Boolean(product.sale),
    },
  };
}

async function migrate() {
  console.log("");
  console.log("====================================");
  console.log(" بدء نقل المنتجات");
  console.log(" Supabase -> Appwrite");
  console.log("====================================");
  console.log("");

  const products = await getAllProducts();

  console.log(
    `✅ عدد المنتجات الموجودة في Supabase: ${products.length}`
  );

  if (!products.length) {
    console.log("لا توجد منتجات للنقل.");
    return;
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < products.length; i++) {
    const product = convertProduct(products[i]);

    try {
      await tablesDB.upsertRow({
        databaseId: APPWRITE_DATABASE_ID,
        tableId: APPWRITE_TABLE_ID,
        rowId: product.rowId,
        data: product.data,
      });

      success++;

      console.log(
        `✅ ${i + 1}/${products.length} | المنتج #${product.data.product_id}`
      );
    } catch (error) {
      failed++;

      console.error(
        `❌ المنتج #${product.data.product_id}:`,
        error.message || error
      );
    }
  }

  console.log("");
  console.log("====================================");
  console.log(" انتهى النقل");
  console.log("====================================");
  console.log(`✅ نجح: ${success}`);
  console.log(`❌ فشل: ${failed}`);
  console.log("ℹ️ Supabase لم يتم تعديله.");
  console.log("");
}

migrate().catch((error) => {
  console.error("");
  console.error("❌ توقف النقل:");
  console.error(error.message || error);
  process.exit(1);
});