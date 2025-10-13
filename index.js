import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ✅ número da Bea (coloque o DDI 55)
const WHATSAPP_BEA = "5519996293227"; // <-- altere para o número real da Bea (ex: 5591999999999)

app.post("/webhook", async (req, res) => {
  console.log("📩 Webhook recebido:", JSON.stringify(req.body, null, 2));

  try {
    const event = req.body;
    const paymentId = event.data?.id;

    if (!paymentId) {
      console.log("⚠️ Nenhum paymentId recebido no webhook");
      return res.status(400).json({ ok: false, msg: "paymentId ausente" });
    }

    // ✅ Buscar detalhes do pagamento no Mercado Pago
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    const payment = await mpRes.json();
    console.log("💰 Detalhes do pagamento:", payment);

    // ✅ Se aprovado, manda pra planilha e WhatsApp
    if (payment.status === "approved") {
      console.log("✅ Pagamento aprovado! Enviando para Google Script...");

      // Formatar data para o formato brasileiro
      const dataAgendada = payment.metadata?.diaagendada
        ? new Date(payment.metadata.diaagendada).toLocaleDateString("pt-BR")
        : "";

      const agendamento = {
        nome: payment.metadata?.nome || "",
        diaagendado: dataAgendada,
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

      // ✅ Enviar para Google Sheets
      const scriptRes = await fetch(process.env.GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(agendamento)
      });
      const scriptData = await scriptRes.json();
      console.log("📤 Retorno do Google Script:", scriptData);

      // ✅ Mensagem personalizada para WhatsApp
      const mensagem = encodeURIComponent(
        `Oi Bea! 💅\n\nNovo agendamento confirmado:\n👤 Cliente: ${agendamento.nome}\n📅 Data: ${agendamento.diaagendado}\n⏰ Horário: ${agendamento.horaagendada}\n💆 Serviço: ${agendamento.servico}\n💵 Status: ${agendamento.status}\n\nVerifique na planilha 👇`
      );
      const linkWhatsApp = `https://wa.me/${WHATSAPP_BEA}?text=${mensagem}`;

      console.log("📱 Link WhatsApp:", linkWhatsApp);

      if (scriptRes.ok && scriptData.success) {
        console.log("✅ Agendamento adicionado na planilha!");
      } else {
        console.log("⚠️ Falha ao adicionar agendamento:", scriptData);
      }

      // ✅ Retorna com link do WhatsApp
      return res.status(200).json({
        ok: true,
        msg: "Pagamento aprovado e enviado para planilha.",
        whatsapp_link: linkWhatsApp
      });
    } else {
      console.log(`⏳ Pagamento não aprovado, status: ${payment.status}`);
      return res.status(200).json({ ok: false, msg: `Pagamento ${payment.status}` });
    }
  } catch (err) {
    console.error("💥 Erro no webhook:", err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

app.listen(10000, () => console.log("🚀 Servidor rodando na porta 10000"));
