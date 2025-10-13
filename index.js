import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

// Função utilitária para converter data ISO → BR
function isoToBR(isoDate) {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

// 🧩 Endpoint para gerar o pagamento
app.post("/gerar-pagamento", async (req, res) => {
  try {
    const { nome, whatsapp, servico, precoTotal, diaagendado, horaagendada } = req.body;
    console.log("📥 Recebido /gerar-pagamento:", req.body);

    if (!nome || !whatsapp || !servico || !precoTotal) {
      return res.status(400).json({ ok: false, msg: "Campos obrigatórios ausentes" });
    }

    const preferenciaData = {
      items: [
        {
          title: servico,
          quantity: 1,
          unit_price: parseFloat(precoTotal),
          currency_id: "BRL",
        },
      ],
      payer: {
        name: nome,
      },
      back_urls: {
        success: `${process.env.BASE_URL}/sucesso`,
        failure: `${process.env.BASE_URL}/falha`,
        pending: `${process.env.BASE_URL}/pendente`,
      },
      auto_return: "approved",
      notification_url: `${process.env.BASE_URL}/notificacao`,
      external_reference: `${nome}-${Date.now()}`,
    };

    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(preferenciaData),
    });

    const preferencia = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error("❌ Erro Mercado Pago:", preferencia);
      return res.status(400).json(preferencia);
    }

    console.log("✅ Preferência criada:", preferencia.id);
    return res.json({ ok: true, init_point: preferencia.init_point });
  } catch (err) {
    console.error("💥 Erro /gerar-pagamento:", err);
    return res.status(500).json({ ok: false, msg: err.message });
  }
});

// 📡 Webhook Mercado Pago — processa pagamento aprovado
app.post("/notificacao", async (req, res) => {
  try {
    const pagamento = req.body;
    console.log("🔔 Notificação recebida:", pagamento);

    // Dependendo do modo, o Mercado Pago pode enviar apenas o ID aqui:
    if (pagamento.type === "payment" && pagamento.data && pagamento.data.id) {
      const id = pagamento.data.id;
      const mpResp = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      });
      const detalhes = await mpResp.json();

      console.log("💳 Detalhes do pagamento:", detalhes);

      if (detalhes.status === "approved") {
        const data = {
          nome: detalhes.payer.first_name || "Cliente",
          servico: detalhes.description || "Serviço",
          diaagendada: isoToBR(detalhes.date_approved?.split("T")[0]) || "",
          horaagendada: new Date(detalhes.date_approved).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          valor30: `R$ ${(detalhes.transaction_amount * 0.3).toFixed(2)}`,
          status: "Aprovado",
          whatsapp: "+55" + (detalhes.payer.phone?.number || "000000000"),
          transaction_id: detalhes.id,
          reference: detalhes.external_reference || "",
        };

        // Envia para planilha
        const sheetResp = await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        const sheetJson = await sheetResp.json();
        console.log("📄 Planilha:", sheetJson);

        // Envia WhatsApp automático
        const mensagem = encodeURIComponent(
          `✅ Olá ${data.nome}! Seu pagamento de ${data.servico} foi confirmado com sucesso.\n\n📅 Data: ${data.diaagendada}\n🕐 Horário: ${data.horaagendada}\n💰 Valor sinal: ${data.valor30}\n\nNos vemos em breve! 💖`
        );
        const zapUrl = `https://api.whatsapp.com/send?phone=${data.whatsapp}&text=${mensagem}`;
        console.log("📲 Enviando mensagem WhatsApp:", zapUrl);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("💥 Erro /notificacao:", err);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
