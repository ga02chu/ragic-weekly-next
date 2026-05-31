-- 分店分攤「校正紀錄」— 給跨店支援、休息卡打錯店等系統算不準的情況人工校正
-- 在 Supabase SQL Editor 執行（務必確認網址列 project ref = pboqxswqhpubfmehukqy）
--
-- 兩種 kind：
--   'manual'   店為單位的手動加減（在「分店分攤」底部 🔧 手動調整區）
--                → 用 store_cat + delta_h（可正可負）
--   'reassign' 個人逐筆改歸（在「異常」分頁，把某人某筆 H 從 from_cat 改歸 to_cat）
--                → 用 from_cat / to_cat / delta_h（正數），系統自動 from_cat −H、to_cat +H

create table if not exists hr_store_adjustments (
  id           uuid primary key default gen_random_uuid(),
  period_start date not null,         -- 期間起（與報表 from 對齊）
  period_end   date not null,         -- 期間迄（與報表 to 對齊）
  kind         text not null default 'manual',  -- 'manual' | 'reassign'
  store_cat    text,                   -- manual 用：要加減的店
  delta_h      numeric not null,       -- manual：可正可負；reassign：正數（要搬的時數）
  -- reassign 用欄位 ─────────────────────────────────────────
  from_cat     text,                   -- 來源店（系統原本算到這）
  to_cat       text,                   -- 目標店（改歸到這）
  emp_id       text,                   -- 來源員工工號
  emp_name     text,                   -- 來源員工姓名（顯示用）
  src_date     text,                   -- 來源異常日期（防同一筆重複套用）
  -- ───────────────────────────────────────────────────────
  reason       text default '',        -- 說明（自動帶或手填）
  created_at   timestamptz default now(),
  created_by   text
);

-- 若表早已存在（舊版只有 manual 欄位），create if not exists 會整個跳過，
-- 故用 add column if not exists 補欄位，並放寬 store_cat（reassign 不填）
alter table hr_store_adjustments add column if not exists kind text not null default 'manual';
alter table hr_store_adjustments add column if not exists from_cat text;
alter table hr_store_adjustments add column if not exists to_cat text;
alter table hr_store_adjustments add column if not exists emp_id text;
alter table hr_store_adjustments add column if not exists emp_name text;
alter table hr_store_adjustments add column if not exists src_date text;
alter table hr_store_adjustments alter column store_cat drop not null;

create index if not exists hr_store_adj_period_idx
  on hr_store_adjustments (period_start, period_end);

-- 透過 SQL 建表不會自動授權，必須手動授權＋關 RLS（與 hr_raw_uploads 同處理）
alter table hr_store_adjustments disable row level security;
grant all on hr_store_adjustments to anon, authenticated, service_role;

-- 讓 PostgREST 立刻看到新表
notify pgrst, 'reload schema';
