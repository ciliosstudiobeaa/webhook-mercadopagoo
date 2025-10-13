import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// === VARIÁVEIS DE AMBIENTE ===
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

// === ROTA DE TESTE ===
app.get("/", (req, res) => {
  res.send("Servidor ativo — integração Mercado Pago + Google Sheets rodando!");
});

// === GERAR PAGAMENTO ===
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;
    console.log("📦 Dados recebidos do front:", req.body);

    // 🛑 1. BLOQUEAR HORÁRIO DUPLICADO
    const checkRes = await fetch(`${GOOGLE_SCRIPT_URL}?check=true&dia=${diaagendado}&hora=${horaagendada}`);
    const checkData = await checkRes.json().catch(() => ({}));

    if (checkData && checkData.ocupado) {
      console.warn("⚠️ Horário já ocupado:", diaagendado, horaagendada);
      return res.status(400).json({ error: "Esse horário já está reservado. Escolha outro." });
    }

    // 💰 Criação da preferência Mercado Pago
    const body = {
      items: [
        {
          title: `Sinal de agendamento - ${servico}`,
          quantity: 1,
          currency_id: "BRL",
          unit_price: parseFloat(precoTotal * 0.3),
        },
      ],
      payer: {
        name: nome,
        email: `${whatsapp}@ciliosdabea.fake`, // apenas pra MP aceitar
      },
      metadata: { nome, whatsapp, servico, diaagendado, horaagendada },
      back_urls: {
        success: "https://wa.me/" + whatsapp,
        failure: "https://ciliosdabea.com.br/erro",
      },
      auto_return: "approved",
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await mpRes.json();
    console.log("✅ Preferência criada:", data.id);
    return res.json({ init_point: data.init_point });

  } catch (err) {
    console.error("❌ Erro ao gerar pagamento:", err);
    return res.status(500).json({ error: err.message });
  }
});

// === WEBHOOK MERCADO PAGO ===
app.post("/webhook", async (req, res) => {
  try {
    console.log("📩 Webhook recebido:", JSON.stringify(req.body));

    const paymentId = req.body?.data?.id;
    if (!paymentId) {
      console.warn("⚠️ Webhook sem paymentId");
      return res.status(200).json({ ok: false, msg: "Sem paymentId" });
    }

    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    const paymentData = await paymentRes.json();

    const status = paymentData.status;
    console.log(`🔎 Status do pagamento ${paymentId}: ${status}`);

    if (status === "approved") {
      console.log("✅ Pagamento aprovado! Enviando para Google Script...");

      const metadata = paymentData.metadata || {};
      const dataBR = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

      const rowData = {
        nome: metadata.nome || "Desconhecido",
        diaagendado: metadata.diaagendado || "",
        horaagendada: metadata.horaagendada || "",
        servico: metadata.servico || "",
        valor30: paymentData.transaction_amount || "",
        status: "Aprovado",
        whatsapp: metadata.whatsapp || "",
        dataRegistro: dataBR, // 🇧🇷 Data/hora brasileira
        transaction_id: paymentData.transaction_details?.transaction_id || paymentData.id || "",
        reference: "MP-" + paymentId,
      };

      // Envia para Google Script
      const gRes = await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rowData),
      });
      const gData = await gRes.text();
      console.log("📤 Retorno do Google Script:", gData);

      // 💬 2. Envia mensagem automática no WhatsApp
      const mensagem = encodeURIComponent(
        `Olá ${metadata.nome}! 💕\n\nSeu pagamento do serviço *${metadata.servico}* foi confirmado!\n` +
        `📅 Data: ${metadata.diaagendado}\n⏰ Horário: ${metadata.horaagendada}\n\n` +
        `Nos vemos em breve no estúdio Ciliosdabea ✨`
      );
      const link = `https://wa.me/${metadata.whatsapp}?text=${mensagem}`;
      console.log("📲 Link de mensagem automática:", link);

      // (não precisa abrir nada, o cliente vai ser redirecionado ao sucesso)
      return res.status(200).json({ ok: true, whatsappMsg: link });
    }

    console.log("Pagamento não aprovado, status:", status);
    return res.status(200).json({ ok: false, msg: "Pagamento não aprovado" });

  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// === INICIALIZA SERVIDOR ===
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
