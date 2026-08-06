/*
 * tax-core.js — налоговая математика НК РК 2026 (Esep).
 * СГЕНЕРИРОВАНО из server/src/services/tax — НЕ ПРАВИТЬ РУКАМИ,
 * правки затираются пересборкой: cd server && npm run build:tax-core
 * Ставки вшиты как дефолты: EsepTax.DEFAULT_RATES (версия EsepTax.DEFAULT_VERSION).
 */
var EsepTax = (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // src/services/tax/rates.js
  var require_rates = __commonJS({
    "src/services/tax/rates.js"(exports, module) {
      var DEFAULT_VERSION = "2026.03";
      var DEFAULT_RATES = Object.freeze({
        // Базовые показатели
        mrp: 4325,
        mzp: 85e3,
        // Упрощёнка (910)
        ipn_rate_910: 0.04,
        sn_rate_910: 0,
        "910_year_mrp": 6e5,
        "910_max_employees": 999999,
        // Соцплатежи за себя
        opv_rate: 0.1,
        opvr_rate: 0.035,
        so_rate: 0.05,
        vosms_rate_self: 0.05,
        vosms_base_mult: 1.4,
        // Соцплатежи за сотрудников
        emp_opvr_rate: 0.035,
        emp_so_rate: 0.05,
        emp_vosms_rate: 0.03,
        emp_vosms_max_mult: 40,
        ee_opv_rate: 0.1,
        ee_vosms_rate: 0.02,
        ee_vosms_max_mult: 20,
        ee_social_tax_rate: 0.06,
        // Самозанятые
        self_emp_rate: 0.04,
        self_emp_month_limit: 300,
        self_emp_year_limit: 3600,
        // НДС
        vat_rate: 0.16,
        vat_threshold_mrp: 1e4,
        // ОУР — прогрессивная шкала ИПН
        general_ipn_rate: 0.1,
        general_ipn_rate_high: 0.15,
        general_ipn_threshold_mrp: 8500,
        ipn_deduction_mrp: 30,
        // ТОО
        kpn_rate: 0.2,
        social_tax_too_rate: 0.06,
        dividend_tax_rate: 0.05,
        // СН для ИП на ОУР (фикс в МРП)
        ip_sn_mrp_self: 2,
        ip_sn_mrp_per_employee: 1
      });
      function parseNumber(value) {
        if (value == null) return null;
        const s = String(value).trim();
        if (s === "") return null;
        const num = Number(s);
        return Number.isFinite(num) ? num : null;
      }
      function resolveRates(raw = {}) {
        const rates = { ...DEFAULT_RATES };
        for (const key of Object.keys(DEFAULT_RATES)) {
          const num = parseNumber(raw[key]);
          if (num !== null) rates[key] = num;
        }
        const rawVersion = raw.config_version != null ? String(raw.config_version).trim() : "";
        return { rates, version: rawVersion !== "" ? rawVersion : DEFAULT_VERSION };
      }
      async function loadRates(db) {
        try {
          const { rows } = await db.query("SELECT key, value FROM tax_config");
          const raw = {};
          for (const r of rows) raw[r.key] = r.value;
          return resolveRates(raw);
        } catch (err) {
          console.error("[tax/rates] tax_config \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D, \u0441\u0447\u0438\u0442\u0430\u0435\u043C \u043F\u043E \u0434\u0435\u0444\u043E\u043B\u0442\u0430\u043C:", err.message);
          return resolveRates();
        }
      }
      module.exports = { DEFAULT_RATES, DEFAULT_VERSION, resolveRates, loadRates };
    }
  });

  // src/services/tax/calc.js
  var require_calc = __commonJS({
    "src/services/tax/calc.js"(exports, module) {
      function clamp(x, lo, hi) {
        return Math.min(hi, Math.max(lo, x));
      }
      function calculate910(rates, income, { regionalAdjustment = 0, regionalDiscount = 0 } = {}) {
        const adjustment = regionalAdjustment !== 0 ? regionalAdjustment : -regionalDiscount;
        const totalRate = rates.ipn_rate_910 + rates.sn_rate_910;
        const effectiveRate = clamp(totalRate + adjustment, 0, 1);
        const ipn = income * effectiveRate;
        return {
          income,
          ipn,
          sn: 0,
          // СН = 0% для СНР с 2026
          totalTax: ipn,
          effectiveIpnRate: effectiveRate,
          effectiveSnRate: 0,
          effectiveRate: income > 0 ? ipn / income : 0
        };
      }
      function calculateMonthlySocial(rates, { bornBefore1975 = false } = {}) {
        const opv = rates.mzp * rates.opv_rate;
        const opvr = bornBefore1975 ? 0 : rates.mzp * rates.opvr_rate;
        const so = rates.mzp * rates.so_rate;
        const vosms = rates.mzp * rates.vosms_base_mult * rates.vosms_rate_self;
        return { opv, opvr, so, vosms, total: opv + opvr + so + vosms };
      }
      function calculateFull910(rates, halfYearIncome, { regionalAdjustment = 0, regionalDiscount = 0, bornBefore1975 = false } = {}) {
        const tax = calculate910(rates, halfYearIncome, { regionalAdjustment, regionalDiscount });
        const monthlySocial = calculateMonthlySocial(rates, { bornBefore1975 });
        const socialHalfYear = monthlySocial.total * 6;
        const grandTotal = tax.totalTax + socialHalfYear;
        return {
          tax,
          monthlySocial,
          socialHalfYear,
          grandTotal,
          effectiveRate: halfYearIncome > 0 ? grandTotal / halfYearIncome : 0
        };
      }
      function calculateProgressiveIpn(rates, annualIncome) {
        if (annualIncome <= 0) return 0;
        const threshold = rates.mrp * rates.general_ipn_threshold_mrp;
        if (annualIncome <= threshold) return annualIncome * rates.general_ipn_rate;
        return threshold * rates.general_ipn_rate + (annualIncome - threshold) * rates.general_ipn_rate_high;
      }
      function calculateSelfEmployed(rates, income) {
        return income * rates.self_emp_rate;
      }
      function calculateTooTax(rates, {
        income,
        expenses,
        isVatPayer = false,
        employeeCount = 0,
        monthlyPayroll = 0,
        kpnRateOverride = null
        // ставка по виду деятельности (ст. 357); null → база
      } = {}) {
        const taxableIncome = Math.max(0, income - expenses);
        const kpn = taxableIncome * (kpnRateOverride != null ? kpnRateOverride : rates.kpn_rate);
        const vatReceived = isVatPayer ? income * rates.vat_rate : 0;
        const vatPaid = isVatPayer ? expenses * rates.vat_rate : 0;
        const vatPayable = Math.max(0, vatReceived - vatPaid);
        const socialTax = Math.max(0, monthlyPayroll * rates.social_tax_too_rate) * employeeCount;
        const netProfit = taxableIncome - kpn;
        const dividendTax = netProfit * rates.dividend_tax_rate;
        const totalTax = kpn + vatPayable;
        return {
          income,
          expenses,
          taxableIncome,
          kpn,
          vatReceived,
          vatPaid,
          vatPayable,
          socialTax,
          netProfit,
          dividendTax,
          totalTax,
          effectiveRate: income > 0 ? totalTax / income : 0
        };
      }
      function selfEmployedLimit(rates) {
        return {
          monthlyTenge: rates.mrp * rates.self_emp_month_limit,
          yearlyTenge: rates.mrp * rates.self_emp_year_limit
        };
      }
      function vatThreshold(rates) {
        return { thresholdTenge: rates.mrp * rates.vat_threshold_mrp, rate: rates.vat_rate };
      }
      function simplified910YearLimit(rates) {
        return rates.mrp * rates["910_year_mrp"];
      }
      function simplified910HalfYearLimit(rates) {
        return simplified910YearLimit(rates) / 2;
      }
      function ipMonthlySocialTax(rates, { employees = 0 } = {}) {
        return rates.mrp * (rates.ip_sn_mrp_self + rates.ip_sn_mrp_per_employee * employees);
      }
      module.exports = {
        calculate910,
        calculateMonthlySocial,
        calculateFull910,
        calculateProgressiveIpn,
        calculateSelfEmployed,
        calculateTooTax,
        selfEmployedLimit,
        vatThreshold,
        simplified910YearLimit,
        simplified910HalfYearLimit,
        ipMonthlySocialTax
      };
    }
  });

  // src/services/tax/form910.js
  var require_form910 = __commonJS({
    "src/services/tax/form910.js"(exports, module) {
      var { calculateMonthlySocial } = require_calc();
      var FORM_CODE = "910.00";
      var FORM_VERSION = 27;
      var FORM_REVISION = 133;
      var NON_CASH_SOURCES = ["kaspi", "\u043F\u0435\u0440\u0435\u0432\u043E\u0434", "\u043A\u0430\u0440\u0442\u0430"];
      function txYearMonth(date) {
        if (date instanceof Date) return { year: date.getFullYear(), month: date.getMonth() + 1 };
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date));
        if (!m) throw new Error(`\u041D\u0435\u0440\u0430\u0437\u0431\u0438\u0440\u0430\u0435\u043C\u0430\u044F \u0434\u0430\u0442\u0430 \u0442\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u0438: ${date}`);
        return { year: Number(m[1]), month: Number(m[2]) };
      }
      function calculateForm910(rates, input) {
        const {
          iin,
          fullName,
          halfYear,
          // 1 или 2
          year,
          declarationType = "\u043E\u0447\u0435\u0440\u0435\u0434\u043D\u0430\u044F",
          // 'очередная' | 'дополнительная' | 'ликвидационная'
          transactions = [],
          employeeCount = 0,
          totalPayroll = 0,
          bornBefore1975 = false
        } = input;
        const startMonth = halfYear === 1 ? 1 : 7;
        const endMonth = halfYear === 1 ? 6 : 12;
        const relevant = transactions.filter((t) => {
          const d = txYearMonth(t.date);
          return d.year === year && d.month >= startMonth && d.month <= endMonth;
        });
        const income = relevant.filter((t) => t.isIncome).reduce((s, t) => s + t.amount, 0);
        const incomeNonCash = relevant.filter((t) => t.isIncome && NON_CASH_SOURCES.includes(t.source)).reduce((s, t) => s + t.amount, 0);
        const calculatedTax = income * (rates.ipn_rate_910 + rates.sn_rate_910);
        const taxAdjustment = 0;
        const netTax = calculatedTax - taxAdjustment;
        const ipn = netTax;
        const social = calculateMonthlySocial(rates, { bornBefore1975 });
        const socialTax = 0;
        const totalTax = ipn + socialTax;
        const totalSocial = (social.so + social.opv + social.opvr + social.vosms) * 6;
        return {
          iin,
          fullName,
          halfYear,
          year,
          declarationType,
          income,
          incomeNonCash,
          incomeEcommerce: 0,
          transferPricing: 0,
          avgEmployees: employeeCount,
          avgMonthlyWage: employeeCount > 0 ? totalPayroll / employeeCount : 0,
          calculatedTax,
          taxAdjustment,
          netTax,
          ipn,
          socialTax,
          soIncome: rates.mzp * 6,
          soAmount: social.so * 6,
          opvIncome: rates.mzp * 6,
          opvAmount: social.opv * 6,
          opvrAmount: social.opvr * 6,
          vosmsAmount: social.vosms * 6,
          totalTax,
          totalSocial,
          grandTotal: totalTax + totalSocial,
          periodLabel: halfYear === 1 ? `1-\u0435 \u043F\u043E\u043B\u0443\u0433\u043E\u0434\u0438\u0435 ${year}` : `2-\u0435 \u043F\u043E\u043B\u0443\u0433\u043E\u0434\u0438\u0435 ${year}`
        };
      }
      function fieldValues(d) {
        return {
          field_910_00_001: d.income,
          field_910_00_001_A: d.incomeNonCash,
          field_910_00_001_B: d.incomeEcommerce,
          field_910_00_002: d.transferPricing,
          field_910_00_003: d.avgEmployees,
          field_910_00_004: d.avgMonthlyWage,
          field_910_00_005: d.calculatedTax,
          field_910_00_006: d.taxAdjustment,
          field_910_00_007: d.netTax,
          field_910_00_008: d.ipn,
          field_910_00_009: d.socialTax,
          field_910_00_010: d.soIncome,
          field_910_00_011: d.soAmount,
          field_910_00_012: d.opvIncome,
          field_910_00_013: d.opvAmount,
          field_910_00_014: d.opvrAmount,
          field_910_00_015: d.vosmsAmount
        };
      }
      function declarationTypeField(d) {
        switch (d.declarationType) {
          case "\u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u0430\u044F":
            return "dt_additional";
          case "\u043B\u0438\u043A\u0432\u0438\u0434\u0430\u0446\u0438\u043E\u043D\u043D\u0430\u044F":
            return "dt_final";
          default:
            return "dt_main";
        }
      }
      var fmtAmount = (v) => v.toFixed(2);
      var fmtDate = (d) => {
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        return `${dd}.${mm}.${d.getFullYear()}`;
      };
      function escapeXml(input) {
        return String(input).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
      }
      function generateForm910Xml(data, { now = /* @__PURE__ */ new Date() } = {}) {
        const fields = fieldValues(data);
        const dtField = declarationTypeField(data);
        const fieldXml = Object.entries(fields).map(([k, v]) => `  <${k}>${fmtAmount(v)}</${k}>`).join("\n");
        return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  \u0424\u043E\u0440\u043C\u0430 910.00 (\u0432\u0435\u0440\u0441\u0438\u044F ${FORM_VERSION}, \u0440\u0435\u0432\u0438\u0437\u0438\u044F ${FORM_REVISION}) \u2014 \u0441\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u0430 Esep.
  \u0418\u043C\u0435\u043D\u0430 \u043F\u043E\u043B\u0435\u0439 \u2014 \u0438\u0437 \u043E\u0444\u0438\u0446\u0438\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u043F\u0430\u043A\u0435\u0442\u0430 \u0421\u041E\u041D\u041E. \u041A\u043E\u0440\u043D\u0435\u0432\u043E\u0439 \u043A\u043E\u043D\u0432\u0435\u0440\u0442 \u0440\u0435\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u043D
  \u043F\u043E \u0434\u043E\u0433\u0430\u0434\u043A\u0435: \u041F\u0415\u0420\u0415\u0414 \u041F\u041E\u0414\u0410\u0427\u0415\u0419 \u0441\u0432\u0435\u0440\u0438\u0442\u044C \u0441 \u043E\u0431\u0440\u0430\u0437\u0446\u043E\u043C \u044D\u043A\u0441\u043F\u043E\u0440\u0442\u0430 \u0438\u0437 1\u0421/\u0421\u041E\u041D\u041E.
  \u0414\u0430\u0442\u0430 \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u0438: ${fmtDate(now)}
-->
<form code="${FORM_CODE}" version="${FORM_VERSION}" revision="${FORM_REVISION}">
  <iin>${escapeXml(data.iin)}</iin>
  <payer_name1>${escapeXml(data.fullName)}</payer_name1>
  <period_year>${data.year}</period_year>
  <period_half_year>${data.halfYear}</period_half_year>
  <${dtField}>1</${dtField}>
  <currency_code>KZT</currency_code>
${fieldXml}
</form>`;
      }
      function generateForm910Json(data, { now = /* @__PURE__ */ new Date() } = {}) {
        const payload = {
          _meta: {
            generatedBy: "Esep",
            generatedAt: now.toISOString(),
            note: "\u041A\u043E\u043D\u0432\u0435\u0440\u0442 \u043D\u0435 \u0441\u0432\u0435\u0440\u0451\u043D \u0441 \u043E\u0444\u0438\u0446\u0438\u0430\u043B\u044C\u043D\u043E\u0439 \u0441\u0445\u0435\u043C\u043E\u0439 \u0418\u0421\u041D\u0410"
          },
          formCode: FORM_CODE,
          version: FORM_VERSION,
          revision: FORM_REVISION,
          period: {
            year: data.year,
            halfYear: data.halfYear
          },
          taxpayer: {
            iin: data.iin,
            name: data.fullName
          },
          declarationType: declarationTypeField(data),
          currencyCode: "KZT",
          fields: Object.entries(fieldValues(data)).reduce((acc, [k, v]) => {
            acc[k] = Number(v.toFixed(2));
            return acc;
          }, {})
        };
        return JSON.stringify(payload, null, 2);
      }
      module.exports = {
        FORM_CODE,
        FORM_VERSION,
        FORM_REVISION,
        calculateForm910,
        generateForm910Xml,
        generateForm910Json
      };
    }
  });

  // src/services/tax/index.js
  var require_index = __commonJS({
    "src/services/tax/index.js"(exports, module) {
      var rates = require_rates();
      var calc = require_calc();
      var form910 = require_form910();
      module.exports = {
        ...rates,
        ...calc,
        ...form910
      };
    }
  });
  return require_index();
})();
