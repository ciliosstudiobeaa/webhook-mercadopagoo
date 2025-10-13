import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

app.post("/webhook", async (req, res) => {
  console.log("Webhook recebido:", JSON.stringify(req.body, null, 2));

  try {
    const event = req.body;
    const paymentId = event.data?.id;

    if (!paymentId) {
      console.log("Nenhum paymentId recebido no webhook");
      return res.status(400).json({ ok: false, msg: "paymentId ausente" });
    }

    // Buscar detalhes do pagamento
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });

    const payment = await mpRes.json();
    console.log("Detalhes do pagamento:", payment);

    if (payment.status === "approved") {
      console.log("Pagamento aprovado! Enviando para Google Script...");

      const agendamento = {
        nome: payment.metadata?.nome || "",
        diaagendado: payment.metadata?.diaagendada || "",
        horaagendada: payment.metadata?.horaagendada || "",
        servico: payment.metadata?.servico || "",
        valor30: payment.transaction_amount
          ? `R$ ${(payment.transaction_amount * 0.3).toFixed(2)}`
          : "",
        status: "Aprovado",
        whatsapp: payment.metadata?.whatsapp || "",
        transaction_id: payment.id || "",
        reference: payment.external_reference || ""
      };

      const scriptRes = await fetch(process.env.GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(agendamento)
      });

      const scriptData = await scriptRes.json();
      console.log("Resposta do Google Script:", scriptData);

      if (scriptRes.ok && scriptData.success) {
        console.log("✅ Agendamento adicionado com sucesso na planilha!");
      } else {
        console.log("⚠️ Falha ao adicionar agendamento na planilha:", scriptData);
      }
    } else {
      console.log(`Pagamento não aprovado, status: ${payment.status}`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook:", err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

app.listen(10000, () => console.log("Servidor rodando na porta 10000"));
