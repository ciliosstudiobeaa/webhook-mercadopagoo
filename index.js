// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// === VARIÁVEIS DE AMBIENTE ===
// MP_ACCESS_TOKEN (access token do Mercado Pago - sandbox ou produção)
// GOOGLE_SCRIPT_URL (URL do Google Apps Script que grava na planilha)
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

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
    // aceita ?date=DD/MM/YYYY opcional — se não vier, retorna todos aprovados
    const { date } = req.query;
    const response = await fetch(GOOGLE_SCRIPT_URL);
    const data = await response.json();
    let approved = data.filter(x => x.status === "Aprovado");
    if (date) {
      approved = approved.filter(x => x.diaagendado === date);
    }
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
    console.log("POST /gerar-pagamento recebido:", { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada });

    if (!nome || !whatsapp || !servico || !precoTotal || !diaagendado || !horaagendada) {
      return res.status(400).json({ error: "Campos obrigatórios faltando" });
    }

    const precoLimpo = limparValor(precoTotal);
    if (precoLimpo <= 0) {
      return res.status(400).json({ error: "Valor inválido" });
    }

    // Monta payload da preferência
    const payload = {
      items: [
        { title: servico, quantity: 1, unit_price: precoLimpo }
      ],
      payment_methods: {
        excluded_payment_types: [], // permite todos (Pix, credit_card, boleto)
      },
      back_urls: {
        success: "https://seusite.com/sucesso",
        failure: "https://seusite.com/falha",
        pending: "https://seusite.com/pendente"
      },
      auto_return: "approved",
      external_reference: JSON.stringify({ nome, whatsapp, servico, precoTotal: precoLimpo, diaagendado, horaagendada }),
      statement_descriptor: "Ciliosdabea"
      // não colocamos notification_url aqui porque já recebemos via webhook centralizado,
      // mas você pode colocar `${process.env.BACKEND_URL}/webhook` se quiser.
    };

    console.log("Payload preference:", JSON.stringify(payload, null, 2));

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`
      },
      body: JSON.stringify(payload)
    });

    const mpJson = await mpRes.json();
    console.log("Resposta MP preference:", mpJson);

    // preference id (para usar no checkout transparente do cartão)
    const preferenceId = mpJson.id || null;

    // Tentar extrair dados PIX (vários caminhos possíveis dependendo do retorno)
    let pix_qr_code = null;       // imagem URL (alguns retornos)
    let pix_payload = null;       // string copia & cola do PIX
    let pix_expiration = null;    // data de expiração, se existir

    // Possíveis localizações — tentativas de fallback
    if (mpJson.point_of_interaction && mpJson.point_of_interaction.transaction_data) {
      const t = mpJson.point_of_interaction.transaction_data;
      pix_qr_code = t.qr_code || t.qr_code_base64 || pix_qr_code;
      pix_payload = t.qr_code || t.qr_code_base64 || pix_payload;
      // alguns retornos usam 'ticket_url' ou 'qr_code_base64'
      if (t.expiration_date) pix_expiration = t.expiration_date;
    }
    if (!pix_qr_code && mpJson.additional_info && mpJson.additional_info.transaction_data) {
      const t = mpJson.additional_info.transaction_data;
      pix_qr_code = t.qr_code || t.qr_code_base64 || pix_qr_code;
      pix_payload = t.qr_code || t.qr_code_base64 || pix_payload;
      if (t.expiration_date) pix_expiration = t.expiration_date;
    }

    // Em sandbox, às vezes existe sandbox_init_point (url) — mantemos para debug
    const init_point = mpJson.init_point || mpJson.sandbox_init_point || null;

    // Retorna o que conseguimos (preference_id para cartão; pix_qr_code / pix_payload para Pix)
    res.json({
      ok: true,
      preference_id: preferenceId,
      init_point,
      pix_qr_code,   // pode ser null (fallback)
      pix_payload,   // string para gerar QR localmente (base64 ou payload)
      pix_expiration: pix_expiration || null,
      raw: mpJson // para debug (pode remover em produção)
    });

  } catch (e) {
    console.error("Erro ao gerar pagamento:", e);
    res.status(500).json({ error: "Erro interno" });
  }
});

// -------------------- WEBHOOK --------------------
app.post("/webhook", async (req, res) => {
  try {
    const { type, data } = req.body;
    console.log("Webhook recebido:", JSON.stringify(req.body).slice(0, 1000));

    if (type === "payment") {
      const paymentId = data.id;
      console.log("Webhook payment id:", paymentId);

      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
      });
      const mpData = await mpRes.json();
      console.log("Dados do pagamento:", mpData);

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

        console.log("Enviando para Google Script:", { nome, whatsapp, servico, diaagendado, horaagendada, status, valor30, transaction_id, reference });

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
    console.error("Erro no webhook:", err);
    res.sendStatus(500);
  }
});

// -------------------- START --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
