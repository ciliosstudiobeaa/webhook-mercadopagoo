import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

// ===== DADOS DOS SERVIÇOS (APLICAÇÃO) =====
const SERVICOS = {
  "Volume brasileiro — Aplicação": 130,
  "Efeito molhado — Aplicação": 140,
  "Fox eyes — Aplicação": 170,
  "Volume europeu — Aplicação": 160,
  "Volume árabe — Aplicação": 150,
  "Efeito rímel — Aplicação": 130,
  "Efeito delineado — Aplicação": 170,
  "Expres — Aplicação": 100,
  "Anime lash — Aplicação": 170,
  "Efeito mega — Aplicação": 180
};

// ===== FUNÇÃO PARA CONSULTAR PLANILHA =====
async function horarioDisponivel(dia, hora) {
  try {
    console.log("🔎 Verificando horários disponíveis...");
    const res = await fetch(`${GOOGLE_SCRIPT_URL}?aba=Agendamentos`);
    const linhas = await res.json(); // [{diaagendado, horaagendada, servico}]
    const horaMinutos = hora.split(":").map(Number)[0] * 60 + hora.split(":")[1] * 1;

    for (const l of linhas) {
      if (!l.horaagendada || !l.diaagendado) continue;
      if (l.diaagendado === dia) {
        const horaExistente = l.horaagendada.split(":").map(Number)[0] * 60 + l.horaagendada.split(":")[1] * 1;
        if (horaExistente === horaMinutos) {
          console.log("⛔ Horário já ocupado:", l);
          return false;
        }
      }
    }
    return true;
  } catch (err) {
    console.error("❌ Erro ao verificar disponibilidade:", err);
    return false;
  }
}

// ===== ROTA TESTE =====
app.get("/", (req, res) => res.send("Servidor ativo — Mercado Pago + Google Sheets rodando!"));

// ===== GERAR PAGAMENTO =====
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;

    console.log("📩 Recebido /gerar-pagamento:", req.body);

    if (!nome || !whatsapp || !servico || !precoTotal || !diaagendado || !horaagendada) {
      return res.status(400).json({ error: "Preencha todos os campos." });
    }

    // Verifica horário
    const disponivel = await horarioDisponivel(diaagendado, horaagendada);
    if (!disponivel) return res.status(400).json({ error: "Horário indisponível." });

    // Garante que unit_price seja número
    const valorUnit = Number(precoTotal) * 0.3;
    if (isNaN(valorUnit)) throw new Error("Valor do serviço inválido.");

    const body = {
      items: [{ title: `Sinal - ${servico}`, quantity: 1, currency_id: "BRL", unit_price: valorUnit }],
      payer: { name: nome, email: `${whatsapp}@ciliosdabea.fake` },
      metadata: { nome, whatsapp, servico, diaagendado, horaagendada },
      back_urls: { success: "https://example.com/success", failure: "https://example.com/failure" },
      auto_return: "approved"
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const mpData = await mpRes.json();
    console.log("💰 Preferência Mercado Pago criada:", mpData);

    return res.json({ init_point: mpData.init_point });

  } catch (err) {
    console.error("❌ Erro /gerar-pagamento:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ===== WEBHOOK PAGAMENTO =====
app.post("/webhook", async (req, res) => {
  try {
    const paymentId = req.body?.data?.id;
    if (!paymentId) return res.status(200).json({ ok: false, msg: "Sem paymentId" });

    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
    });

    const paymentData = await paymentRes.json();
    console.log("💳 Webhook pagamento:", paymentData.status);

    if (paymentData.status === "approved") {
      const metadata = paymentData.metadata || {};

      const rowData = {
        nome: metadata.nome || "",
        diaagendado: metadata.diaagendado || "",
        horaagendada: metadata.horaagendada || "",
        servico: metadata.servico || "",
        valor30: paymentData.transaction_amount || "",
        status: "Aprovado",
        whatsapp: metadata.whatsapp || "",
        transaction_id: paymentData.id || "",
        reference: "MP-" + paymentId
      };

      // Envia para Google Script
      const gRes = await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rowData)
      });
      await gRes.text();
      console.log("✅ Dados enviados para planilha:", rowData);

      // Link WhatsApp automático
      const msg = encodeURIComponent(
        `Olá ${metadata.nome}! 💖\nSeu agendamento do serviço *${metadata.servico}* foi confirmado.\n📅 Data: ${metadata.diaagendado}\n⏰ Horário: ${metadata.horaagendada}\n💰 Pagamento aprovado!`
      );
      const waLink = `https://wa.me/${metadata.whatsapp}?text=${msg}`;
      console.log("📲 Link WhatsApp automático:", waLink);

      return res.status(200).json({ ok: true, waLink });
    }

    return res.status(200).json({ ok: false, msg: "Pagamento não aprovado" });

  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
