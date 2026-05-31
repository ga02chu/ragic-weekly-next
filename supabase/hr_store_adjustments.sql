-- 分店分攤「手動調整」(C) — 給跨店支援、休息卡打錯店等系統算不準的情況人工校正
-- 在 Supabase SQL Editor 執行（務必確認網址列 project ref = pboqxswqhpubfmehukqy）

create table if not exists hr_store_adjustments (
  id           uuid primary key default gen_random_uuid(),
  period_start date not null,         -- 期間起（與報表 from 對齊）
  period_end   date not null,         -- 期間迄（與報表 to 對齊）
  store_cat    text not null,         -- 品牌概念店 / 料韓男2號店 / 料韓男3號店 / 英洙家 / 其他
  delta_h      numeric not null,      -- +支援時數 / -誤算時數
  reason       text default '',       -- 說明（例：加英洙家支援 9.93 / 扣英洙家打卡 8.95）
  created_at   timestamptz default now(),
  created_by   text
);

create index if not exists hr_store_adj_period_idx
  on hr_store_adjustments (period_start, period_end);

-- 透過 SQL 建表不會自動授權，必須手動授權＋關 RLS（與 hr_raw_uploads 同處理）
alter table hr_store_adjustments disable row level security;
grant all on hr_store_adjustments to anon, authenticated, service_role;

-- 讓 PostgREST 立刻看到新表
notify pgrst, 'reload schema';
