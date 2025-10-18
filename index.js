// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// === VARIÁVEIS DE AMBIENTE ===
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN; // seu access token
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL; // script que grava na planilha

if (!MP_ACCESS_TOKEN) console.warn("ATENÇÃO: MP_ACCESS_TOKEN não definido (variável de ambiente).");

// util: limpa valor (aceita "130", "130,00", "R$ 130" etc)
function limparValor(valor) {
  if (valor === undefined || valor === null) return 0;
  let num = String(valor).replace(/[^\d.,]/g, "");
  num = num.replace(",", ".");
  const parsed = parseFloat(num);
  return isNaN(parsed) ? 0 : parsed;
}

function formatarDataBR(dataISO) {
  if (!dataISO) return "";
  const partes = dataISO.split("-");
  if (partes.length !== 3) return dataISO;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

// -------------------- HORÁRIOS BLOQUEADOS --------------------
app.get("/horarios-bloqueados", async (req, res) => {
  try {
    const { date } = req.query;
    const response = await fetch(GOOGLE_SCRIPT_URL);
    const data = await response.json();
    let approved = data.filter(x => x.status === "Aprovado");
    if (date) approved = approved.filter(x => x.diaagendado === date);
    res.json(approved);
  } catch (e) {
    console.error("Erro ao buscar horários:", e);
    res.status(500).json({ error: "Erro ao buscar horários" });
  }
});

// -------------------- GERAR PAGAMENTO (PIX + CARTÃO) --------------------
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;
    if (!nome || !whatsapp || !servico || !precoTotal || !diaagendado || !horaagendada) {
      return res.status(400).json({ error: "Campos obrigatórios faltando" });
    }

    // Aqui você quer cobrar 30% como sinal — se preferir passar precoTotal completo, ajuste.
    const precoLimpo = limparValor(precoTotal) * 0.3; // 30% do valor enviado
    if (precoLimpo <= 0) return res.status(400).json({ error: "Valor inválido" });

    const external_reference_obj = { nome, whatsapp, servico, precoTotal: precoLimpo, diaagendado, horaagendada };
    const payload = {
      items: [{ title: servico, quantity: 1, unit_price: precoLimpo }],
      payment_methods: { excluded_payment_types: [] },
      back_urls: {
        success: "https://seusite.com/sucesso",
        failure: "https://seusite.com/falha",
        pending: "https://seusite.com/pendente"
      },
      auto_return: "approved",
      external_reference: JSON.stringify(external_reference_obj),
      statement_descriptor: "Ciliosdabea"
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`
      },
      body: JSON.stringify(payload)
    });

    const mpJson = await mpRes.json();
    // debug log
    console.log("MP preference response:", JSON.stringify(mpJson).slice(0, 2000));

    // Extract preference id and PIX info (robust/fallback)
    const preference_id = mpJson.id || null;
    const init_point = mpJson.init_point || mpJson.sandbox_init_point || null;

    let pix_qr_code = null;
    let pix_payload = null;
    let pix_expiration = null;

    // try several paths
    try {
      const t1 = mpJson.point_of_interaction?.transaction_data;
      if (t1) {
        pix_qr_code = pix_qr_code || t1.qr_code || t1.qr_code_base64 || null;
        pix_payload = pix_payload || t1.qr_code || t1.qr_code_base64 || null;
        pix_expiration = pix_expiration || t1.expiration_date || null;
      }
    } catch (e) { /* ignore */ }

    try {
      const t2 = mpJson.additional_info?.transaction_data;
      if (t2) {
        pix_qr_code = pix_qr_code || t2.qr_code || t2.qr_code_base64 || null;
        pix_payload = pix_payload || t2.qr_code || t2.qr_code_base64 || null;
        pix_expiration = pix_expiration || t2.expiration_date || null;
      }
    } catch (e) { /* ignore */ }

    // resposta
    res.json({
      ok: true,
      preference_id,
      init_point,
      pix_qr_code,
      pix_payload,
      pix_expiration,
      external_reference: JSON.stringify(external_reference_obj),
      raw: mpJson // só para debug; remova em produção se quiser
    });
  } catch (e) {
    console.error("Erro ao gerar pagamento:", e);
    res.status(500).json({ error: "Erro interno" });
  }
});

// -------------------- CHECK PAYMENT (polling) --------------------
// Endpoint usado pelo frontend para checar se o pagamento já foi aprovado.
// Aceita:
//  - ?preference_id=...  OR
//  - ?external_reference=... (stringified JSON or plain string)
// Retorna { ok: true, approved: true/false, payment_id: '...', raw: ... }
app.get("/check-payment", async (req, res) => {
  try {
    const { preference_id, external_reference } = req.query;
    if (!preference_id && !external_reference) {
      return res.status(400).json({ error: "Falta preference_id ou external_reference" });
    }

    // Primeiro tentativa: buscar pagamentos por external_reference (se fornecida)
    let searchUrl = null;
    if (external_reference) {
      searchUrl = `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(external_reference)}`;
    } else if (preference_id) {
      // tentar por preference_id
      searchUrl = `https://api.mercadopago.com/v1/payments/search?preference_id=${encodeURIComponent(preference_id)}`;
    }

    const mpRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const mpJson = await mpRes.json();
    // mpJson.results é um array quando houver
    const results = mpJson.results || mpJson;

    // percorre resultados e procura pagamentos aprovados
    let approvedPayment = null;
    if (Array.isArray(results)) {
      for (const p of results) {
        if (p && (p.status === "approved" || (p.status_detail && p.status_detail.toLowerCase().includes("approved")) || p.status === "authorized")) {
          approvedPayment = p;
          break;
        }
      }
    } else if (results && results.status === "approved") {
      approvedPayment = results;
    }

    if (approvedPayment) {
      // obtem payment id
      const payment_id = approvedPayment.id || approvedPayment.payment_id || approvedPayment.transaction_details?.transaction_id || null;
      return res.json({ ok: true, approved: true, payment_id, raw: approvedPayment });
    }

    return res.json({ ok: true, approved: false, raw: mpJson });
  } catch (e) {
    console.error("Erro em /check-payment:", e);
    res.status(500).json({ error: "Erro interno" });
  }
});

// -------------------- WEBHOOK --------------------
app.post("/webhook", async (req, res) => {
  try {
    const { type, data } = req.body;
    console.log("Webhook recebido:", JSON.stringify(req.body).slice(0,1000));

    if (type === "payment") {
      const paymentId = data.id;
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
      });
      const mpData = await mpRes.json();
      console.log("Dados do pagamento:", JSON.stringify(mpData).slice(0,1000));

      if (mpData.status === "approved") {
        let externalRef = {};
        try { externalRef = JSON.parse(mpData.external_reference); } catch (err) { externalRef = {}; }

        const nome = externalRef.nome || "";
        const whatsapp = externalRef.whatsapp || "";
        const servico = externalRef.servico || mpData.description || "";
        const diaagendado = formatarDataBR(externalRef.diaagendado || "");
        const horaagendada = externalRef.horaagendada || "";
        const status = "Aprovado";
        const valor30 = limparValor(mpData.transaction_amount || externalRef.precoTotal);
        const transaction_id = mpData.transaction_details?.transaction_id || "";
        const reference = paymentId || "";

        // envia para planilha
        await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nome,
            whatsapp,
            servico,
            diaagendado,
            horaagendada,
            status,
            "Valor 30%": valor30,
            transaction_id,
            reference
          })
        });
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Erro webhook MP:", err);
    res.sendStatus(500);
  }
});

// -------------------- START --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
