-- ========================================================
-- الجزء الثاني: حسابات الزبائن + سجلات الطلبات (الفواتير)
-- نفّذ هذا السكربت مرة وحدة بـ SQL Editor بلوحة Supabase
-- (بعد ما تكون نفّذت migration.sql الأول)
-- ========================================================

-- ---------- جدول الملفات الشخصية (profiles) ----------
-- كل مستخدم مسجل (سواء زبون أو أدمن) بياخذ صف هون تلقائياً
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  is_admin boolean not null default false,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid());

-- دالة + trigger تنشئ صف بـ profiles تلقائياً كل ما حدا يسجل حساب جديد
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- جدول الطلبات / سجلات الفاتورة (orders) ----------
create table if not exists public.orders (
  id bigserial primary key,
  customer_id uuid references auth.users(id) on delete set null,
  customer_name text,
  customer_phone text,
  country text,
  items jsonb not null,
  total numeric not null,
  created_at timestamptz default now()
);

alter table public.orders enable row level security;

-- الزبون (مسجل دخول) يقدر يضيف طلب لحاله بس
drop policy if exists "Customers can insert their own orders" on public.orders;
create policy "Customers can insert their own orders"
  on public.orders for insert
  to authenticated
  with check (customer_id = auth.uid());

-- بند: السماح بحفظ طلبات الزوار غير المسجلين (بدون customer_id) كمان،
-- مشان تنحفظ الفاتورة بلوحة الأدمن حتى لو الزبون ما سجل حساب
drop policy if exists "Guests can insert orders without account" on public.orders;
create policy "Guests can insert orders without account"
  on public.orders for insert
  to anon
  with check (customer_id is null);

-- الزبون يشوف بس طلباته هو
drop policy if exists "Customers can read their own orders" on public.orders;
create policy "Customers can read their own orders"
  on public.orders for select
  to authenticated
  using (customer_id = auth.uid());

-- الأدمن (is_admin = true بجدول profiles) يشوف كل الطلبات
drop policy if exists "Admins can read all orders" on public.orders;
create policy "Admins can read all orders"
  on public.orders for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );

-- ========================================================
-- ⚠️ خطوة أخيرة ضرورية: علّم حسابك انت كـ "أدمن"
-- بدّل الإيميل تحت بالإيميل يلي تستخدمه لدخول admin.html
-- ونفّذ السطر هذا لحاله بعد كل الكود يلي فوق
-- ========================================================
update public.profiles set is_admin = true
where email = 'REPLACE_WITH_YOUR_ADMIN_EMAIL@example.com';