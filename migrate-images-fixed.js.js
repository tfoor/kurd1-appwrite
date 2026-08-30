require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { createClient } = require("@supabase/supabase-js");
const sdk = require("node-appwrite");
const { InputFile } = require("node-appwrite/file");

const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY;

const supabase = createClient(
  process.env.SUPABASE_URL,
  supabaseKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

const client = new sdk.Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const storage = new sdk.Storage(client);
const tablesDB = new sdk.TablesDB(client);

const BUCKET = "product-images";

const APPWRITE_BUCKET_ID =
  process.env.APPWRITE_BUCKET_ID;

const DB_ID =
  process.env.APPWRITE_DATABASE_ID;

const TABLE_ID =
  process.env.APPWRITE_TABLE_ID;

// مجلد المشروع الحالي
const PROJECT_ROOT = __dirname;


// =====================================
// التحقق من الإعدادات
// =====================================

function check(name, value) {
  if (!value) {
    throw new Error(
      `${name} غير موجود في ملف .env`
    );
  }
}

check(
  "SUPABASE_URL",
  process.env.SUPABASE_URL
);

check(
  "SUPABASE_ANON_KEY أو SERVICE_ROLE",
  supabaseKey
);

check(
  "APPWRITE_ENDPOINT",
  process.env.APPWRITE_ENDPOINT
);

check(
  "APPWRITE_PROJECT_ID",
  process.env.APPWRITE_PROJECT_ID
);

check(
  "APPWRITE_API_KEY",
  process.env.APPWRITE_API_KEY
);

check(
  "APPWRITE_BUCKET_ID",
  APPWRITE_BUCKET_ID
);

check(
  "APPWRITE_DATABASE_ID",
  DB_ID
);

check(
  "APPWRITE_TABLE_ID",
  TABLE_ID
);


// =====================================
// نوع الصورة
// =====================================

function getMimeType(fileName) {

  const ext =
    path.extname(fileName).toLowerCase();

  const types = {
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".avif": "image/avif"
  };

  return (
    types[ext] ||
    "application/octet-stream"
  );
}


// =====================================
// البحث عن الصورة داخل ملفات المشروع
// =====================================

function findLocalImage(relativePath) {

  if (!relativePath) {
    return null;
  }

  const cleanPath =
    String(relativePath)
      .replace(/^["']|["']$/g, "")
      .replace(/^\/+/, "")
      .replace(/\\/g, "/");

  const fullPath =
    path.resolve(
      PROJECT_ROOT,
      cleanPath
    );

  if (
    fs.existsSync(fullPath) &&
    fs.statSync(fullPath).isFile()
  ) {
    return fullPath;
  }

  return null;
}


// =====================================
// إنشاء رابط Supabase للصورة
// =====================================

function getSupabaseImageUrl(img) {

  const cleanPath =
    String(img).replace(/^\/+/, "");

  return (
    `${process.env.SUPABASE_URL}` +
    `/storage/v1/object/public/` +
    `${BUCKET}/` +
    encodeURI(cleanPath)
  );
}


// =====================================
// قراءة الصورة
// =====================================

async function readImage(product) {

  const img =
    String(product.img || "").trim();

  if (!img) {
    throw new Error(
      "المنتج لا يحتوي على صورة"
    );
  }


  // -------------------------------
  // أولاً: البحث في ملفات الكمبيوتر
  // -------------------------------

  const localPath =
    findLocalImage(img);

  if (localPath) {

    return {

      buffer:
        fs.readFileSync(localPath),

      fileName:
        path.basename(localPath),

      contentType:
        getMimeType(localPath),

      source:
        `محلي: ${path.relative(
          PROJECT_ROOT,
          localPath
        )}`

    };
  }


  // -------------------------------
  // ثانيًا: رابط كامل
  // -------------------------------

  let url;

  if (
    /^https?:\/\//i.test(img)
  ) {

    url = img;

  } else {

    // -----------------------------
    // ثالثًا: Supabase Storage
    // -----------------------------

    url =
      getSupabaseImageUrl(img);
  }


  const response =
    await fetch(url);

  if (!response.ok) {

    throw new Error(
      `تعذر تحميل الصورة HTTP ${response.status}\n` +
      `${url}`
    );
  }


  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  if (!buffer.length) {

    throw new Error(
      "الصورة فارغة"
    );
  }


  return {

    buffer,

    fileName:
      path.basename(
        img.split("?")[0]
      ) || "image.webp",

    contentType:
      response.headers.get(
        "content-type"
      ) ||
      getMimeType(img),

    source:
      `رابط: ${url}`

  };
}


// =====================================
// جلب المنتجات من Supabase
// =====================================

async function getProducts() {

  let from = 0;

  const step = 500;

  const products = [];


  while (true) {

    const {
      data,
      error
    } = await supabase
      .from("products")
      .select("id,img")
      .order(
        "id",
        {
          ascending: true
        }
      )
      .range(
        from,
        from + step - 1
      );


    if (error) {

      throw new Error(
        "فشل قراءة المنتجات: " +
        error.message
      );
    }


    if (
      !data ||
      data.length === 0
    ) {

      break;
    }


    products.push(...data);


    if (
      data.length < step
    ) {

      break;
    }


    from += step;
  }


  return products;
}


// =====================================
// التحقق هل الملف موجود في Appwrite
// =====================================

async function fileExists(fileId) {

  try {

    await storage.getFile({

      bucketId:
        APPWRITE_BUCKET_ID,

      fileId

    });

    return true;

  } catch (error) {

    if (
      Number(error?.code) === 404
    ) {

      return false;
    }

    throw error;
  }
}


// =====================================
// رفع الصورة إلى Appwrite
// =====================================

async function uploadImage(
  productId,
  image
) {

  const fileId =
    `product-${productId}`;


  const exists =
    await fileExists(fileId);


  if (exists) {

    return {

      fileId,

      uploaded: false

    };
  }


  await storage.createFile({

    bucketId:
      APPWRITE_BUCKET_ID,

    fileId,

    file:
      InputFile.fromBuffer(
        image.buffer,
        `${productId}-${image.fileName}`
      ),

    permissions: [

      sdk.Permission.read(
        sdk.Role.any()
      )

    ]

  });


  return {

    fileId,

    uploaded: true

  };
}


// =====================================
// تحديث رابط الصورة في المنتج
// =====================================

async function updateProduct(
  productId,
  fileId
) {

  const imageUrl =

    `${process.env.APPWRITE_ENDPOINT}` +

    `/storage/buckets/` +

    `${APPWRITE_BUCKET_ID}` +

    `/files/` +

    `${fileId}` +

    `/view?project=` +

    `${encodeURIComponent(
      process.env.APPWRITE_PROJECT_ID
    )}`;


  await tablesDB.updateRow({

    databaseId:
      DB_ID,

    tableId:
      TABLE_ID,

    rowId:
      String(productId),

    data: {

      image:
        imageUrl

    }

  });


  return imageUrl;
}


// =====================================
// بدء النقل
// =====================================

async function migrate() {

  console.log("");

  console.log(
    "============================================"
  );

  console.log(
    " نقل الصور: المشروع / Supabase → Appwrite"
  );

  console.log(
    "============================================"
  );

  console.log("");

  console.log(
    `📁 مجلد المشروع: ${PROJECT_ROOT}`
  );

  console.log("");


  const products =
    await getProducts();


  console.log(
    `✅ عدد المنتجات: ${products.length}`
  );

  console.log("");


  let uploaded = 0;

  let alreadyExists = 0;

  let updated = 0;

  let noImage = 0;

  let failed = 0;

  let localImages = 0;

  let remoteImages = 0;


  for (
    let i = 0;
    i < products.length;
    i++
  ) {

    const product =
      products[i];

    const productId =
      Number(product.id);


    console.log("");

    console.log(
      `[${i + 1}/${products.length}] المنتج #${productId}`
    );


    if (!product.img) {

      noImage++;

      console.log(
        "⚠️ لا توجد صورة"
      );

      continue;
    }


    try {

      const image =
        await readImage(product);


      if (
        image.source.startsWith("محلي")
      ) {

        localImages++;

      } else {

        remoteImages++;
      }


      console.log(
        `   ${image.source}`
      );


      const result =
        await uploadImage(
          productId,
          image
        );


      if (result.uploaded) {

        uploaded++;

        console.log(
          "   ✅ تم رفع الصورة"
        );

      } else {

        alreadyExists++;

        console.log(
          "   ↪️ الصورة موجودة مسبقًا"
        );
      }


      await updateProduct(
        productId,
        result.fileId
      );


      updated++;


      console.log(
        "   ✅ تم ربط الصورة بالمنتج"
      );


    } catch (error) {

      failed++;

      console.log(
        `   ❌ فشل المنتج #${productId}`
      );

      console.log(
        `   ${error?.message || error}`
      );
    }
  }


  console.log("");

  console.log(
    "============================================"
  );

  console.log(
    " انتهى نقل الصور"
  );

  console.log(
    "============================================"
  );

  console.log(
    `✅ تم رفع: ${uploaded}`
  );

  console.log(
    `↪️ موجودة مسبقًا: ${alreadyExists}`
  );

  console.log(
    `✅ تم تحديث المنتجات: ${updated}`
  );

  console.log(
    `📁 صور محلية: ${localImages}`
  );

  console.log(
    `🌐 صور من روابط: ${remoteImages}`
  );

  console.log(
    `⚠️ بدون صورة: ${noImage}`
  );

  console.log(
    `❌ فشل: ${failed}`
  );

  console.log("");

  console.log(
    "ℹ️ Supabase لم يتم تعديله."
  );
}


// =====================================
// التشغيل
// =====================================

migrate().catch(
  (error) => {

    console.error("");

    console.error(
      "❌ توقف النقل:"
    );

    console.error(
      error?.message ||
      error
    );

    process.exit(1);

  }
);