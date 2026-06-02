---
name: visual-vs-data-divergence
description: When debugging a UI/layout bug in George's 資產追蹤 PWA where the measurements/data look correct but the visual is still wrong, use this skill BEFORE bumping CSS values, retrying chart.resize(), or rebuilding components. Invoke when the user reports "區塊擠在一起", "跑版", "位置不對", "間距不見了", "切過 tab 之後就壞了", "明明 X 是對的可是看起來不對", or whenever you'd be tempted to "just try increasing min-height again". The root cause in this codebase has historically been inline style overrides killing CSS rules — especially style.display='block' silently disabling flex/grid gap. Check inline style FIRST.
---

# visual-vs-data-divergence

「數據顯示正確，但畫面就是不對」是這個 PWA 最容易讓人鬼打牆的 bug 類型 — 因為直覺會想去調 CSS 數值，但根本原因常常是 JS 寫了 inline style 覆蓋掉 CSS 規則。這個 skill 是踩過很多輪坑換來的診斷順序。

## 觸發情境

- 使用者說「擠在一起」「跑版」「間距不見」「切過 tab 就壞了」
- 你已經量過尺寸、印出 `getComputedStyle()`、看起來都對，但畫面就是不對
- 你已經試過一次 `chart.resize()` / 拉大 `min-height` / 重新渲染，沒效果
- 你正準備「再把 min-height 加 50px 試試看」← **這是訊號，停手用這個 skill**

## 核心教訓（必記）

> **當數據與直覺衝突時，先檢查 inline style 是否覆蓋了 CSS。**

CSS 的 `gap`、`flex-direction`、`grid-template-*` 只在 **flex / grid 容器**上有效。若 JS 把 `element.style.display = 'block'` 寫死 → CSS 裡的 `display: flex; gap: 14px;` **就被靜默蓋掉，gap 變 0**。

這個 codebase 真實發生過一次（`switchTab()` 切回總覽時把 `#tab-overview` 設成 `display: block` → 第一列和第二列之間原本由 `gap: 14px` 撐開的空隙瞬間歸零）。從用戶角度只是「擠在一起」，從 DOM 量測角度所有尺寸都對 — 因為 gap 失效是「容器讓子元素貼在一起」，不是「子元素變高了」。

## 標準診斷順序

按這個順序做，**不要跳步**：

### 步驟 1：對著有問題的元素，先拿 inline style

```js
const el = document.getElementById('tab-overview'); // 或對應 element
console.log('inline:', el.getAttribute('style'));
console.log('display computed:', getComputedStyle(el).display);
console.log('gap computed:', getComputedStyle(el).gap);
```

**重點是先看 inline 屬性。** `getComputedStyle()` 是最終結果，看不出來「為什麼是這個值」。`getAttribute('style')` 直接告訴你 JS 寫了什麼進去。

### 步驟 2：對比 CSS 規則上應該長什麼樣

打開 `theme.css`，找到該 element 的 selector（例如 `#tab-overview`），看 CSS 裡寫的 `display`/`gap`/`flex-direction` 是什麼。

**比對重點**：CSS 寫了 `display: flex; gap: 14px;`，但 `getComputedStyle` 顯示 `display: block`？ → **inline style 在覆蓋**，就是它。

### 步驟 3：找出誰寫了那個 inline style

```bash
grep -n "style.display" "/Users/george/VS Code/My Project/app.js"
grep -n "\.style\.<關鍵屬性>" "/Users/george/VS Code/My Project/app.js"
```

通常會在 tab 切換、modal 開關、動畫 callback 之類的地方找到 `element.style.xxx = 'something'`。

### 步驟 4：修正策略選一個

**A. 用空字串清掉 inline override**（首選 — 最小改動）
```js
el.style.display = condition ? '' : 'none';
//                            ^^ 空字串，讓 CSS 規則生效
```
比 `el.style.display = 'flex'` 更安全 — 因為「flex」是寫死值，下次有人改 CSS 為 grid 就又錯了。空字串等於說「我不管，照 CSS 來」。

**B. 改用 class toggle**（重構時）
```js
el.classList.toggle('is-hidden', !condition);
```
然後 CSS 控制 `.is-hidden { display: none; }`。把所有 display 邏輯收回 CSS。

**C. 真的需要 inline override 時，連 gap 一起設**（最後手段）
```js
el.style.display = 'flex';
el.style.gap = '14px';
```
不推薦 — 重複 CSS 的值，會漂移。

## 反模式（你會想做但不要做）

❌ **第一反應就調 CSS 數值**（min-height 從 280 → 380 → 我再加 50）
理由：尺寸對的話加 CSS 沒用，浪費時間還可能造成新問題。先做步驟 1。

❌ **destroy + recreate Chart 試試看**
理由：很慢、有副作用（動畫重播）、且如果根因是 inline style，重建後一樣會被蓋掉。

❌ **多次 `chart.resize()` / `requestAnimationFrame` 包一層**
理由：尺寸都對的情況下，resize 不會修好任何東西。這只是「我也不知道但我加個 resize 看看」。

❌ **問用戶「能不能拍張截圖」就停下來等**
理由：可以先做步驟 1，截圖只是輔助。除非真的看不出 element 是哪個，先自己跑診斷。

## 給 George 的回報模板

找到根因後，回報時包含三段：
1. **是什麼**：「`switchTab()` 把 `#tab-overview` 設成 `display: block`，蓋掉 CSS 的 `display: flex; gap: 14px;` → gap 失效 → 區塊貼在一起」
2. **為什麼之前看不出來**：「DOM 量測尺寸（419/419/220/220）都對，因為 gap 失效是『容器讓子元素間距變 0』，不是『某個 element 變大』」
3. **怎麼修**：「`style.display = 'block'` → `style.display = ''`，讓 CSS 重新接管」

這樣他能學到 root cause，下次自己看到類似症狀會更快定位。

## 與其他 skills 的關係

- 修完之後，commit 前用 `bump-build-version` 同步版本（cache-busted 才能在手機看到修好）
- 若觸碰 `switchTab()`、資料層、snapshot 邏輯，先看 `pwa-danger-zones`
