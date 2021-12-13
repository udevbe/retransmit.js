# retransmit.js
A generic higher level wrapper to ensure state is retransmitted after network failure


Hanshake:
SendSerialnumber 8 bytes

sendbuffer type 1  + data
Acknowledge type 2 + serienummer

Locale state:
3:
sendserial
receiveserial
processedserial



# Verbinding gemaakt:
ik ontvang de andere kant zijn receive serial number

Ik stuur mijn sendserialnumber, de laagste uit mijn buffer
Ik stuur alle pakketjes uit mijn buffer op

# versturen

Ik verstuur een pakketje, ik hou dat bij in mijn buffer.
Dat pakketje krijgt sendserialnumber++

Ik ontvang een Acknowledgement met serial number
Ik delete uit mijn send buffer alle berichten met 
send serial number lager dan acknowledgement serial number

# ontvangen

Ik ontvang een pakketje
Het serienummer van dat pakketje is de receiveserialnumber++
Ik Kijk na of dat het receiveserienumber kleiner is dan mijn verwerktserienummer
indien ja -> drop
Indien nee -> verwerk + update verwerktserienummer


Af en toe:
ik stuur mijn verwerktserienummer op naar de andere kant als acknowledgement
