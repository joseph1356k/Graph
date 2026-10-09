# Cifras y afirmaciones pendientes de revisión médica

Todas las guías del corpus tienen `revisado_por` vacío: **ninguna** ha sido revisada por un médico. Este archivo
lista, por guía, lo que los redactores marcaron como escrito de memoria o verificado solo con resúmenes
secundarios (los sitios de MinSalud, OMS, CDC, PMC y revistas no fueron alcanzables desde el entorno de
redacción). Prioridad de la revisión: lo marcado **Pendiente** primero.

Estados:
- **Corregido**: se verificó con al menos dos fuentes secundarias concordantes y se corrigió el texto.
- **Verificado (secundario)**: coincide con resúmenes secundarios; falta contrastar con la fuente primaria.
- **Retirado**: no se pudo verificar y se quitó la cifra del corpus.
- **Pendiente**: sigue en el texto; verificar en la fuente primaria antes de firmar la guía.

No es un archivo de guía: `build-guideline-corpus` solo compila los `.md` con cabecera de metadatos.

## crisis-hiperglucemicas-e-hipoglucemia
- **Corregido (2026-10-09):** potasio en CAD/EHH del consenso 2024: < 3,5 mmol/L diferir insulina y reponer 10–20 mmol/h; 3,5–5,0 mmol/L añadir 10–20 mmol por litro; > 5,0 mmol/L insulina sin potasio. El texto anterior decía 20–30 mmol/L (cifra de ADA 2009). Fuentes secundarias: guía de estudio BCEMP, presentación ABCD 2025.
- **Verificado (secundario, 2026-10-09):** potasio de 40 mmol/L en los líquidos una vez documentada la diuresis (recurso docente basado en ISPAD; ISPAD 2022 pide vía central por encima de 40 mmol/L) y cálculo de líquidos para las primeras 48 h.
- **Pendiente:** confirmar en el texto de ISPAD 2022 la frase «reponer el déficit en 24–48 h».

## paro-cardiorrespiratorio-rcp
- **Verificado (secundario):** control de temperatura 32–37,5 °C por al menos 36 h; SpO2 90–98 % (PaO2 60–105 mmHg).
- **Corregido (2026-10-09):** PaCO2 35–45 mmHg atribuida a ESICM 2021 (no confirmada en el texto AHA 2025); «no antes de 72 h» atribuido a AHA 2020 y ERC 2021 (AHA 2025 no lo confirma).

## tamizaje-de-cancer
- **Verificado (secundario):** mamografía bienal 50–69 años (Res. 276 de 2019 que modifica la 3280); examen clínico anual 40–49 años (lineamiento MinSalud).
- **Retirado (2026-10-09):** edades y periodicidad colombianas de FIT (50–75, cada 2 años) y de PSA con tacto rectal (50–75, cada 5 años): no se encontraron en fuentes consultables. El texto remite a la resolución vigente.
- **Verificado (secundario, 2026-10-09):** citología 1-3-3 de 25 a 29 años, ADN-VPH de 30 a 65 años cada 5 años si es negativa, VIA-VILI con tratamiento inmediato en zonas de difícil acceso por personal entrenado y certificado, y repetir ADN-VPH a los 18 meses con citología de triaje negativa (GPC 2014 y documentos que la resumen; la Res. 3280 fija la prueba molecular de 30 a 65).
- **Retirado (2026-10-09):** edades de 30 a 50 años e «intervalo no mayor de 3 años» para VIA-VILI: no se encontraron en las fuentes consultadas.

## desnutricion-aguda-infantil
- **Verificado (secundario, 2026-10-09):** Resolución 115 del 27 de enero de 2026 (modifica parcialmente la 2350): atención al riesgo de desnutrición aguda con puntaje Z > −2 y < −1 DE; F-100 obligatorio en el tratamiento intrahospitalario y ambulatorio y disponibilidad de F-75, F-100 y FTLC por las EPS; el egreso con Z ≥ −2 se considera insuficiente (recuperación con Z ≥ −1 según fuente secundaria). Sivigila «evento 113» confirmado (protocolo actualizado en 2023; Circular 028 de 2025).
- **Retirado (2026-10-09):** «la Res. 115 ordena garantizar fórmula de inicio a menores de 6 meses»: no se encontró en las fuentes consultadas.
- **Pendiente:** confirmar el umbral exacto de egreso en el anexo técnico de la Res. 115; dosis del libro de bolsillo de la OMS 2013 (F-75 130 mL/kg/día, ampicilina 50 mg/kg cada 6 h más gentamicina 7,5 mg/kg/día, ReSoMal 5 mL/kg cada 30 min por 2 h, choque 15 mL/kg en 1 h, transfusión 10 mL/kg en 3 h): coinciden con el conocimiento del revisor del loop, falta contraste con la fuente primaria.

## hemorragia-posparto
- **Verificado (secundario, 2026-10-09):** tabla de choque del Código Rojo (Rev Colomb Obstet Ginecol 2009): leve 16–25 %, pulso 91–100, sistólica 80–90; moderado 26–35 %, pulso 101–120, sistólica 70–79 (corregido: decía 70–80); severo > 35 %, pulso > 120, sistólica < 70. Umbral OMS/FIGO/ICM del 5 de octubre de 2025: actuar desde 300 mL con signos vitales anormales o desde 500 mL.
- **Retirado (2026-10-09):** cifras de la fila «compensado» (500–1 000 mL, 10–15 %) y los cortes de signos vitales anormales de la guía 2025 (pulso > 100, índice de choque > 1, sistólica < 100, diastólica < 60): no confirmados en las fuentes consultadas.

## anticoncepcion
- **Pendiente:** porcentajes de efectividad por método (CDC); categorías de la 6.ª edición de los criterios de elegibilidad de la OMS (2025).

## hemorragia-digestiva
- **Verificado (secundario, 2026-10-09):** ESGE 2021: no suspender la aspirina de prevención secundaria y, si se suspendió, reanudarla lo antes posible, idealmente en 3–5 días (la frase «hacia el día 3» es de la ESGE 2015). Vasoactivos: terlipresina 2 mg IV cada 4 h por 48 h y luego 1 mg cada 4 h (dos revisiones concordantes); octreotide 50 µg en bolo y 50 µg/h, y somatostatina 250 µg en bolo y 250–500 µg/h (una tabla de revisión; otra revisión usa somatostatina 500 µg y 500 µg/h).
- **Pendiente:** contrastar las dosis con la tabla de la guía AASLD 2016 (Hepatology 2017).

## anafilaxia
- **Verificado (secundario, 2026-10-09):** observación escalonada del Resuscitation Council UK 2021 (2 h con una dosis y buena respuesta, dos autoinyectores y acompañamiento; mínimo 6 h con dos dosis o reacción bifásica previa; mínimo 12 h en reacción grave con más de dos dosis, asma grave, absorción continua, consulta nocturna o acceso difícil a urgencias), adoptada por NICE NG258.
- **Corregido (2026-10-09):** NICE NG258 (27 de mayo de 2026) reemplazó a CG134; se retiró la frase «observar a los mayores de 16 años 6 a 12 horas» de CG134 y los menores de 16 se hospitalizan solo si no cumplen los criterios de alta.

## dolor-abdominal-agudo-apendicitis
- **Verificado (secundario, 2026-10-09):** WSES 2020 (recomendación 7.2, 1A): no prolongar el antibiótico posoperatorio más de 3–5 días en la apendicitis complicada con control adecuado del foco. Existe una actualización WSES 2025 que no se revisó.

## malaria
- **Verificado (secundario, 2026-10-09):** cloroquina 25 mg base/kg en 3 días repartida 10 / 7,5 / 7,5 mg/kg (estudio colombiano que cita la guía 2010; un ensayo de Antioquia usa 600 / 450 / 450 mg en adultos, proporción equivalente).
- **Pendiente:** confirmar en la GPC 67-2022 si conserva el reparto 10 / 7,5 / 7,5.

## sifilis
- **Corregido (2026-10-09):** la regla de la CDC 2021 no es «si se pierde una dosis»: el intervalo óptimo es de 7 días y, en la gestante, más de 9 días entre dosis obliga a repetir el esquema completo (página de sífilis latente de la CDC y resumen del departamento de salud de Maine). Algunas guías estatales recientes (California 2025) son más estrictas: reiniciar ante cualquier dosis tardía.

## infecciones-piel-tejidos-blandos
- **Verificado (secundario, 2026-10-09):** piperacilina/tazobactam 3,375 g cada 6–8 h en la infección necrosante (material docente basado en IDSA 2014).
- **Retirado (2026-10-09):** vancomicina «30 mg/kg/día en 2 dosis»: no se encontró en las fuentes consultadas y hay una carta en CID 2015 sobre discrepancias de dosis en esa guía; el texto remite a la dosis por peso del protocolo institucional con niveles.

## consumo-de-alcohol
- **Verificado (secundario, 2026-10-09):** dosis dirigidas por síntomas con CIWA-Ar (diazepam 10–20 mg o lorazepam 2–4 mg, reevaluación horaria); acamprosato 666 mg tres veces al día con 60 kg o más (666/333/333 mg con menos de 60 kg), naltrexona 50 mg al día y disulfiram desde 200 mg al día (formularios del NHS que aplican NICE CG115).
- **Pendiente:** umbral NICE «AUDIT mayor de 15» para la evaluación integral.

## dolor-cronico-y-opioides
- **Verificado (secundario, 2026-10-09):** naloxona 0,4 a 2 mg IV, IM o SC repetible cada 2–3 minutos (referencias de medicamentos que resumen la ficha); CDC 2022: reevaluar al menos cada 2 semanas si se continúan opioides por dolor agudo.

## gota
- **Verificado (secundario, 2026-10-09):** EULAR 2016: colchicina en las primeras 12 h con 1 mg y 0,5 mg el primer día; prednisolona equivalente 30–35 mg al día por 3–5 días (resumen de la guía en prensa médica; la dosis de prednisolona coincide con resúmenes británicos y con el ensayo de Janssens 2008 con 35 mg).
- **Pendiente:** el intervalo de «una hora» entre la dosis de 1 mg y la de 0,5 mg está en otras fuentes (ensayo AGREE), no en el resumen EULAR consultado.

## osteoporosis
- **Verificado (secundario, 2026-10-09):** calcio total 1 000 mg/día en hombres de 50 a 70 años y 1 200 mg/día en mujeres de 51 o más y hombres de 71 o más; vitamina D 800–1 000 UI/día desde los 50 años (resumen de BHOF 2022). DXA en mujeres de 65 años o más y hombres de 70 o más (guía NOF 2014, antecesora de BHOF).
- **Pendiente:** confirmar que BHOF 2022 mantiene esas edades y los criterios de muy alto riesgo de AACE 2020.

## sincope
- **Retirado (2026-10-09):** «2–3 litros de agua y 10 g de sal al día»: no se encontró en las fuentes consultadas y las guías difieren en la cantidad de sal (6 a 10 g/día); el texto dice «más agua y más sal si no hay contraindicación».
- **Pendiente:** reglas de conducción de la ESC 2018 (contrastar con la normativa colombiana).

## cirrosis-y-complicaciones
- **Nueva (2026-10-09):** redactada con búsqueda web; 26 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Lactulosa 25 mL por dosis (una fuente dice cada 2 h, no 1-2 h; otras fuentes dan 20-30 g o 30-45 mL); Rangos de INR en Child-Pugh (1,7-2,3 frente a 1,71-2,20 o 1,8-2,3 según la fuente); Equivalente en sal de 80-120 mmol de sodio (4,6 frente a 4,9-6,9 g); Umbral de sodio para suspender diuréticos (125 frente a 120 mmol/L); Cefotaxima 2 g cada 8 h y ceftriaxona 1 g frente a 2 g al día (solo de ensayos; dosis de la guía no confirmada); Duración de 5 días del antibiótico en PBE; Ciprofloxacino 500 mg/día como profilaxis; Criterios numéricos de la profilaxis primaria (Child-Pugh 9 o más con bilirrubina 3 mg/dL o más, creatinina 1,2 mg/dL o más, BUN 25 mg/dL o más, sodio 130 o menos); Dosis de terlipresina (1 mg cada 4-6 h según EASL frente a 0,85 mg cada 6 h en la ficha de EE. UU.); Albúmina junto al vasoconstrictor (20-40 g/día frente a 40-50 g/día); Albúmina en paracentesis menores de 5 L con PAS <90 mmHg o sodio <130 (una sola fuente); Proteínas 1,2-1,5 g/kg/día y energía 35-40 kcal/kg en encefalopatía (ISHEN; ESPEN/ASPEN dan 1,0-1,5); Espironolactona 100-200 mg de inicio en el primer episodio; Rifaximina desde 14 días antes de un TIPS electivo (una sola fuente); Recurrencia de PBE del 68 % al año sin profilaxis; Código de evento Sivigila de hepatitis B y C (omitido para no activar el escudo de privacidad).
- **Pendiente:** Se agotó el presupuesto de WebSearch (límite compartido de 200 búsquedas por turno), así que algunos puntos quedaron sin una segunda búsqueda. Casi todas las cifras salen de resúmenes secundarios, no del texto primario: hay que contrastarlas con AASLD 2021 (Hepatology 2021;74:1014) y con EASL 2018 (J Hepatol 2018;69:406)
- **Pendiente:** AASLD 2023 para CHC: confirmar si dice 'ecografía con AFP' o 'con o sin AFP'. MDCalc da la segunda forma, que podría ser de la versión 2018
- **Pendiente:** Norepinefrina como alternativa a terlipresina en SHR, y vacunar contra hepatitis A y B: son conductas sin cifra que no se verificaron con búsqueda por falta de presupuesto
- **Pendiente:** Intervalo de 72 h para ajustar diuréticos: verificado en una sola fuente secundaria
- **Pendiente:** Disponibilidad en Colombia (INVIMA/POS) de norfloxacino, rifaximina y terlipresina, y si hay protocolo nacional de MinSalud sobre cirrosis
- **Pendiente:** Hipernatremia o deshidratación por exceso de lactulosa en adultos mayores: es una precaución clínica sin fuente citada
- **Pendiente:** El umbral MELD de 15 o más viene de la guía AASLD/AST de 2013-2014; hay datos más recientes a favor de remitir antes
- **Pendiente:** Códigos CIE-10 de la OMS: K65.0 para PBE y K72.9 para encefalopatía (K76.82 solo existe en CIE-10-CM)

## hepatitis-b-y-c
- **Nueva (2026-10-09):** redactada con búsqueda web; 31 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Umbral de depuración por debajo del cual no se recomienda tenofovir alafenamida (<15 mL/min) y si debe tomarse con comida; Dosis de entecavir ajustadas a la depuración (0,25 mg al día o 0,5 mg cada 48 h): las encontré en una sola ficha y quedaron como 'ajustado a la depuración'; Recomendación específica de la OMS 2024 sobre inmunoglobulina al recién nacido: la OMS no la exige; se atribuyó a CDC y ETMI-Plus; Semana 28–32 para iniciar tenofovir según la revisión colombiana (fuente secundaria; se dejó el 'segundo trimestre' de OMS 2024); Umbral de 20 000 UI/mL de la versión ETMI-Plus 2018 (lo contradice la versión 2021-2030); Edades del ACIP para vacunar a todos los adultos (19–59 años) y esquemas de 0, 1 y 6 meses o de 2 dosis de Heplisav-B (no se escribieron para no confundir con el esquema del PAI); Recuadro de advertencia de la FDA sobre reactivación del VHB con AAD (se agotó el cupo de búsquedas antes de verificarlo); Grupos de tamizaje de la GPC colombiana de hepatitis C 2016/2018 (no se halló el texto); Recomendaciones de fármacos de la GPC colombiana de hepatitis B 2016 (solo se citó su existencia); Duración de la profilaxis antiviral en inmunosupresión (12 y 18 meses, AGA y EASL).
- **Pendiente:** Confirmar en el documento primario de la OMS 2024 los umbrales de APRI y elastografía, y la redacción de los criterios 'otros' (coinfecciones, comorbilidades), verificados solo con resúmenes secundarios
- **Pendiente:** Verificar que la Resolución 3280 de 2018 (anexo materno perinatal) incluye el HBsAg en el primer control; la búsqueda no lo confirmó y se apoyó en la guía de control prenatal del corpus
- **Pendiente:** Confirmar el código 340 del Sivigila en el protocolo vigente del INS (solo se halló en boletines territoriales)
- **Pendiente:** Confirmar que el ETMI-Plus 2021-2030 está vigente frente al Plan Nacional 2025-2031 y si este cambió umbrales o semana de inicio del tenofovir
- **Pendiente:** Contrastar con la ficha técnica INVIMA las dosis de TDF, entecavir y TAF y los ajustes renales (se usaron las fichas de FDA y europea)
- **Pendiente:** Tratamiento de hepatitis C durante el embarazo: la redacción de AASLD-IDSA ('individualizar') no se pudo leer textualmente
- **Pendiente:** Explicación de por qué las personas HBsAg positivas quedan fuera del esquema simplificado (riesgo de reactivación con AAD): falta verificar la advertencia de la FDA
- **Pendiente:** Interpretación del anti-HBc aislado: tomada de la tabla serológica de CDC sin una búsqueda específica
- **Pendiente:** Seguridad del tenofovir durante la lactancia: hay datos limitados y las fichas técnicas son más cautelosas que las guías

## hiponatremia-e-hiperpotasemia
- **Nueva (2026-10-09):** redactada con búsqueda web; 24 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Salbutamol nebulizado 10–20 mg (no verificado; se dejó 'dosis según protocolo'); Dosis de ciclosilicato de sodio y zirconio (10 g tres veces al día) y de patirómero (se remite a la ficha técnica); Duración de la vigilancia de glucemia tras insulina (6 h frente a 12 h): fuentes discordantes o no encontradas; Infusión de dextrosa al 10 % a 50 mL/h (solo se verificó '5 horas, 25 g'); Umbral de bicarbonato <22 mmol/L para usar bicarbonato de sodio; Umbral de potasio ≥6,0 mmol/L para indicar insulina con glucosa y para tomar ECG; Meta de +5 mmol/L en 24 h para los síntomas moderadamente graves (ESE); Ritmo de 1 mmol/L por hora si persisten los síntomas tras el primer aumento de 5 mmol/L; Sodio inicial ≤105 mmol/L como factor de riesgo de desmielinización (panel EE. UU. 2013); Bolo de salina al 3 % en niños (2 mL/kg); Intervalos para controlar el potasio tras el tratamiento (1, 2, 4, 6 y 24 h).
- **Pendiente:** Se agotó el presupuesto de búsquedas web de la sesión antes de terminar. Varias cifras solo tienen una fuente secundaria (no el texto primario de ESE 2014 ni de UKKA 2023): urea 0,25–0,50 g/kg, 0,5–1,0 mL/kg/h, 10 mL/kg de agua libre con desmopresina 2 µg cada 8 h, 150 mL en síntomas moderadamente graves e insulina 10 U con 25 g de glucosa
- **Pendiente:** La UKKA publicó en julio de 2026 una actualización de la guía de hiperpotasemia (calcio IV con evidencia rebajada tras ILCOR 2025; posibles cambios en salbutamol, quelantes y vigilancia de glucemia). Contrastar toda la sección de hiperpotasemia con esa versión vigente
- **Pendiente:** Velocidad de administración del calcio (10 minutos) tomada de la alerta MHRA 2023 y de la HSE; confirmar la redacción final de UKKA 2023/2026
- **Pendiente:** Afirmaciones cualitativas atribuidas a KDIGO 2020 (seudohiperpotasemia, mantener o reintroducir el bloqueo del sistema renina-angiotensina-aldosterona) sin verificación directa en el texto
- **Pendiente:** Diferencia ESE 2014 (no recomienda vaptanes) frente al panel de EE. UU. 2013 (los incluye); verificar la disponibilidad de urea y tolvaptán en Colombia
- **Pendiente:** No se encontró una guía de MinSalud ni de INS sobre estos trastornos; la conversión 7,0 mmol/L ≈ 126 mg/dL es aritmética, no tomada de una fuente
- **Pendiente:** Preparación de la salina al 3 % con las presentaciones colombianas: se dejó 'según el protocolo institucional'

## lesion-renal-aguda
- **Nueva (2026-10-09):** redactada con búsqueda web; 20 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Proteínas de KDIGO (0,8–1,0 / 1,0–1,5 / hasta 1,7 g/kg/día): ERBP no las respalda, otras fuentes dan cifras mayores y había que recortar palabras; Meta de glucemia de KDIGO 110–149 mg/dL: la contradice evidencia posterior; Resultados de STARRT-AKI sobre inicio temprano de la TRR: no se pudieron verificar, se agotó el presupuesto de búsquedas; Punto de corte de la FENa para azoemia prerrenal: no buscado; Plazo de suspensión de la metformina alrededor del contraste: no verificado; Edad ≥65 años como factor de riesgo de NICE en enfermedad aguda: no confirmada en la lista de recomendaciones; Límite exacto de ACR-NKF sobre si 45 queda dentro o fuera (≥45 o >45): ambiguo, el texto dice 'valores superiores'; Velocidad de infusión del gluconato de calcio (cambió en UKKA 2023): no verificada; K >6,5 y pH <7,2 como umbrales de diálisis: venían de un libro de texto, no de NICE; Orden completo de sitios de catéter de KDIGO (femoral, yugular izquierda, subclavia): una sola fuente secundaria, solo se dejó la yugular interna derecha.
- **Pendiente:** No se verificó si existe guía colombiana (MinSalud o Asocolnef) sobre LRA ni la notificación al Sivigila (p. ej. leptospirosis), porque se agotó el presupuesto de búsquedas; la mención de causas tropicales es cualitativa
- **Pendiente:** Confirmar en el texto vigente de NICE NG148 que el umbral <30 de la actualización 2024 aplica a todos los factores de riesgo de contraste; está confirmado para la rec. 1.2.9 (IECA/ARA II)
- **Pendiente:** La lista NICE para comentar con nefrología en 24 h solo se verificó en fuentes secundarias
- **Pendiente:** Contrastar las dosis de hiperpotasemia con la versión final de UKKA 2023 (se vio un PDF 'actualizado julio 2026'); el esquema de control de potasio a 1, 2, 4, 6 y 24 h tiene una sola fuente secundaria
- **Pendiente:** KDIGO 2012 sugería NAC; revisar si KDIGO publicó una actualización de la guía de LRA
- **Pendiente:** Volumen y páginas de las referencias en 'fuente' (Kidney Int Suppl 2012;2:1–138; Radiology 2020;294:660; Kidney Med 2020;2:85; NEJM 2018;378:603) escritos de memoria, sin verificar por búsqueda
- **Pendiente:** Hay otra guía en paralelo (hiponatremia-e-hiperpotasemia.md); conviene revisar que las dosis de potasio sean coherentes entre ambas
- **Pendiente:** En sinonimos.json la sigla 'ira' ya apunta a infección respiratoria aguda; no se propone para LRA para evitar la colisión
- **Pendiente:** Revisar los códigos CIE-10 elegidos (N14.1, N99.0, N13.9)

## meningitis-bacteriana
- **Nueva (2026-10-09):** redactada con búsqueda web; 25 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Umbrales del LCR (leucocitos mayores de 1 000/µL, relación de glucosa LCR/sangre menor de 0,4, proteínas mayores de X mg/dL): los puntos de corte publicados no coinciden (0,23; 0,36; 0,4); Plaquetas menores de 100 000/µL como contraindicación de la PL (solo en un resumen de una guía pediátrica antigua de NICE); Dosis prehospitalaria de bencilpenicilina 1,2 g / 600 mg / 300 mg por edad y de ceftriaxona prehospitalaria 80 mg/kg (no se pudo comprobar en el texto de NICE NG240; además, en Colombia la penicilina cristalina se dosifica en unidades); Frecuencia de ceftriaxona 80 mg/kg de NICE NG240 en niños (una o dos veces al día); Duraciones de NICE NG240 por germen (meningococo 5 días, neumococo 14 días, Hib 10 días); Dosis de vancomicina en adultos (15 a 20 mg/kg cada 8 a 12 h) y de ampicilina en niños (75 mg/kg cada 6 h); Antecedente de enfermedad del SNC como criterio IDSA de TAC previa (se acabó el cupo de búsquedas antes de comprobarlo); Esquema IDSA en inmunocomprometidos (vancomicina + ampicilina + cefepime o meropenem); Plazo de 24 h para la quimioprofilaxis según CDC (solo apareció en una fuente secundaria); Código del evento en Sivigila (535): está confirmado, pero se dejó fuera del texto para no arriesgar el escudo de privacidad.
- **Pendiente:** Se agotó el cupo de búsquedas web del turno (200) antes de terminar la verificación: los puntos siguientes quedaron con fuentes secundarias
- **Pendiente:** Texto literal de NICE NG240 (dosis de ceftriaxona, criterios de neuroimagen y si NICE fija una edad para el riesgo de Listeria): casi todo se verificó con resúmenes (GPnotebook, iatroX, formularios del NHS)
- **Pendiente:** Contraindicaciones de la PL atribuidas a 'recomendaciones pediátricas de NICE': vienen de un resumen de la guía antigua para niños (CG102), no de NG240
- **Pendiente:** Dosis de dexametasona de ESCMID 2016 (10 mg cada 6 h por 4 días en adultos; 0,15 mg/kg en niños): en el texto se atribuyen al ensayo de referencia y a guías británicas, no a ESCMID
- **Pendiente:** ESCMID 2016: añadir vancomicina o rifampicina donde hay neumococo con sensibilidad reducida (confirmado solo con un resumen secundario)
- **Pendiente:** Suspender la dexametasona en Listeria: viene de cohortes observacionales y de Bugs & Drugs; ESCMID y NICE no lo confirmaron directamente
- **Pendiente:** Quimioprofilaxis en gestantes con ceftriaxona: se deduce de que rifampicina y ciprofloxacino se evitan; contrastar con el lineamiento de MinSalud (tabla de contactos y dosis)
- **Pendiente:** Lineamiento de MinSalud de rifampicina antes del egreso para eliminar el estado de portador: viene de un documento antiguo; comprobar si sigue vigente y si se omite cuando el paciente recibió ceftriaxona
- **Pendiente:** Protocolo INS 2024 (evento 535): modalidades de notificación (súper inmediata, inmediata, semanal) por agente y definición de caso vigente; el texto usa la definición de la Circular 033 de 2016
- **Pendiente:** Comprobar si en Colombia se recomienda vancomicina empírica de rutina según la resistencia local del neumococo

## pancreatitis-y-colecistitis
- **Nueva (2026-10-09):** redactada con búsqueda web; 24 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Umbral de dopamina para la disfunción cardiovascular en TG18 (fuentes con ≥5 y con >5 µg/kg/min) y fármaco (noradrenalina frente a epinefrina): quedó como 'hipotensión que requiere vasopresores'; Hipoalbuminemia en colangitis grado II: menor de 0,7 veces el límite inferior normal frente a menor de 25 g/L (fuentes discrepantes); Suspender el antibiótico dentro de las 24 h tras la colecistectomía en colecistitis grados I y II (TG18): no verificado; Hematocrito mayor de 44 % (otra fuente dice 40 %) y BUN de 20 mg/dL o más como predictores de gravedad; Edad mayor de 55 años e IMC mayor de 30 como factores de riesgo de pancreatitis grave; Enzimas normales en cerca del 5 % de los pacientes al ingreso; CPRE en las primeras 24 h con colangitis según ACG 2024 (solo verificada para ACG 2013); Antibióticos concretos por grado en TG18 (cefazolina, ceftriaxona, metronidazol, piperacilina/tazobactam) y umbral de sensibilidad local del 80 % para ampicilina/sulbactam; Plazo de la colecistectomía temprana en colecistitis (72 h desde el inicio o 7 días desde el ingreso); Plazo de la colecistectomía en pancreatitis biliar necrosante (diferirla 6 semanas); Alcohol como causa en el 25 a 35 % de los casos; Criterios pediátricos de pancreatitis (INSPPIRE) y volúmenes de líquidos en niños; Seguridad de la colecistectomía laparoscópica en cualquier trimestre de la gestación; Definición de los factores predictivos negativos de TG18 (bilirrubina de 2 mg/dL o más, disfunción neurológica o respiratoria); Si la pancreatitis o la colecistitis son eventos de notificación en Sivigila: no verificado.
- **Pendiente:** El cupo de búsquedas web del turno se agotó antes de terminar: varios datos quedaron sin una segunda fuente y conviene completarlos en una sesión posterior
- **Pendiente:** Confirmar en el texto completo de ACG 2024 el esquema de 1,5 mL/kg/h con bolos de 10 mL/kg: se verificó en el ensayo WATERFALL y en resúmenes de la guía, no en su texto
- **Pendiente:** Confirmar si ACG 2024 mantiene la CPRE en las primeras 24 h con colangitis concomitante (la guía cita la versión 2013)
- **Pendiente:** Contrastar en la tabla original de TG18 los umbrales diagnósticos de colangitis (partes A y B), el umbral de fiebre del grado II (≥39 °C) y la definición de hipoalbuminemia
- **Pendiente:** Revisar en el flujograma de TG18 qué es 'falla orgánica favorable' y cuáles son los 'factores predictivos negativos' del grado III
- **Pendiente:** Revisar la duración de los antibióticos en la colecistitis según el capítulo antimicrobiano de TG18 y los antibióticos empíricos recomendados por grado
- **Pendiente:** La afirmación de ACG 2024 sobre neoplasia en mayores de 40 años sin causa viene de una sola fuente secundaria
- **Pendiente:** La analgesia según WSES 2019 se tomó de un resumen secundario; confirmar la redacción
- **Pendiente:** No se verificaron recomendaciones específicas para gestantes ni para niños; el texto es genérico y conservador
- **Pendiente:** No se revisó el contenido de la guía colombiana de 2010 ni del estándar de la Universidad Nacional de 2025
- **Pendiente:** CIE-10: se usaron las subcategorías K85.0 a K85.9; verificar si RIPS en Colombia usa K85X

## accidente-ofidico
- **Nueva (2026-10-09):** redactada con búsqueda web; 14 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Viales iniciales de antiveneno para Bothrops según gravedad: las fuentes se contradicen (2/4/6; 2–3/4–6/6–10; 2–3/4–6/7–10; 6–8/10–12/20–25); Viales para Lachesis (8, 10–12, 20–25) y para Crotalus (8/12/20 y otras pautas): solo aparecen en tablas institucionales que no coinciden entre sí; Umbrales de fibrinógeno por gravedad (100–130 mg/dL en el moderado, menos de 100 en el grave): otra clasificación colombiana da valores distintos; Umbral de presión intracompartimental para la fasciotomía (más de 30 mmHg): no hay consenso, las fuentes dan 30–40 mmHg; Volumen de dilución (250–500 mL en adultos; 125–250 o 200 mL en niños) y goteo inicial de 10–15 gotas por minuto; Momento de aparición de la enfermedad del suero (1–12, 5–14, 5–20 o 5–24 días); Repetir el antiveneno cada 6 horas según la OMS: no se encontró el texto literal de la OMS; Proporción de casos por Bothrops (94,6 %) y por Crotalus (1 %), casos al año (≈4 500; 4 702 en 2021; 7 013 en 2024) y letalidad (0,57 %); Capacidad del suero INS contra Lachesis (15 mg de L. muta y 50 mg de L. acrochorda): las versiones del inserto no coinciden; Notificación inmediata de las muertes y registro del lote del antiveneno según la Circular 048: no se pudo confirmar; Dosis de adrenalina para las reacciones al antiveneno; volumen de sangre para la prueba del todo o nada (2 mL según la OMS, 5 mL según una fuente colombiana).
- **Pendiente:** No se pudo consultar la guía MinSalud/INS 2019 de atención clínica integral. Hay que confirmar con ella y con el protocolo INS vigente la tabla de viales por género, gravedad y producto, y añadirla si coincide
- **Pendiente:** Confirmar si el suero polivalente INS vigente cubre Lachesis, o qué producto se usa para Lachesis en Colombia
- **Pendiente:** La dosis anticoral difiere entre el protocolo INS (10 ampollas en moderado y grave) y el inserto (5 o 10 según la región): decidir cuál prima
- **Pendiente:** Manitol al 20 % a 1 g/kg (recomendación por consenso, es controvertida) y la condición de corregir la coagulopatía antes de la fasciotomía (viene de una fuente secundaria)
- **Pendiente:** Momento de la redosificación: las guías colombianas antiguas usan 24 h y 12 h; la OMS usa controles más tempranos
- **Pendiente:** Periodicidad de la notificación al Sivigila (semanal) y si las muertes requieren notificación inmediata
- **Pendiente:** 'No requiere prueba de sensibilidad previa' tiene una sola fuente (inserto INS)
- **Pendiente:** Medidas generales sin fuente textual: retirar anillos, evitar inyecciones intramusculares durante la coagulopatía, medir el perímetro de la extremidad
- **Pendiente:** Año exacto de las 'Guías para el manejo de urgencias toxicológicas' de MinSalud citadas
- **Pendiente:** Pertinencia de W59 entre los códigos CIE-10

## enfermedad-de-chagas
- **Nueva (2026-10-09):** redactada con búsqueda web; 16 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Dosis de benznidazol y nifurtimox de la guía colombiana de 2010 (no se pudo leer la sección de tratamiento); Tabla de dosis de la guía OPS 2018 (no se pudo leer el texto primario); Franjas pediátricas antiguas de nifurtimox de CDC por edad (15–20 mg/kg en 10 años o menos; 12,5–15 mg/kg de 11 a 16 años); Letalidad de cerca del 13 % en los brotes de transmisión oral en Colombia entre 1992 y 2014 (una sola fuente); Hemograma de control hacia el día 21 de benznidazol (no se pudo identificar la fuente); Evitar el alcohol hasta 3 días después de terminar benznidazol (solo una fuente secundaria); Frecuencia de dermatitis con benznidazol (25,4 % en el ensayo EQUITY) y de efectos adversos con nifurtimox; Tasa de transmisión congénita y edad exacta de la serología del lactante en el lineamiento colombiano (10 meses); Plazos en horas de la notificación inmediata y de la investigación de campo en el protocolo vigente del INS; Periodicidad anual del electrocardiograma en la forma indeterminada; Título de IFI de 1:32 o más como positivo (guía colombiana antigua).
- **Pendiente:** Contrastar las dosis con la guía colombiana vigente y con la tabla de la guía OPS 2018. Este documento usa CDC, FDA y Brasil 2018, que difieren en el rango para adultos (5 frente a 5–7 mg/kg/día) y en la duración del nifurtimox (60 frente a 90 días)
- **Pendiente:** Confirmar en el protocolo INS 2022 (evento 205) si el caso agudo y el brote se notifican de forma inmediata y la notificación de los crónicos es semanal; esto se tomó del protocolo anterior del Ministerio
- **Pendiente:** Revisar si el plan nacional de eliminación 2025-2031 adopta las metas ETMI Plus para Chagas y si amplía el tamizaje de gestantes más allá de las zonas endémicas
- **Pendiente:** Verificar la edad de la serología de seguimiento del hijo de madre positiva en el lineamiento colombiano (CDC indica 9–12 meses)
- **Pendiente:** Conducta durante la lactancia: CDC recomienda no tratar; otros protocolos solo difieren el tratamiento al posparto
- **Pendiente:** Indicación en adultos mayores de 50 años y en miocardiopatía avanzada según la guía OPS 2018 (la guía cita a CDC y una tabla de Annals)
- **Pendiente:** Disponibilidad de benznidazol y nifurtimox en Colombia, formulación pediátrica y canal de suministro por el programa ETV
- **Pendiente:** Monitoreo de laboratorio durante el tratamiento (hemograma, función hepática): falta la periodicidad

## intoxicacion-por-organofosforados
- **Nueva (2026-10-09):** redactada con búsqueda web; 16 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Dosis de diazepam (10 mg IV) en convulsiones por organofosforados: no hubo fuente con la dosis IV textual; Umbrales de gravedad por colinesterasa (20 a 50 %, 10 a 20 %, menos de 10 %): son de la colinesterasa sérica y otras fuentes dicen que no se correlaciona con la gravedad; Duración del síndrome intermedio (5 a 18 días; 5 a 15 días): una sola fuente o no encontrada; Plazo de la polineuropatía tardía: las fuentes difieren (1 a 4 semanas, 2 a 3 semanas, 8 a 14 días); Dosis pediátrica de pralidoxima (15 mg/kg y luego 10 mg/kg/h según Queensland, frente a 25 mg/kg en reportes de caso); Máximos de pralidoxima (2 g de carga, 650 mg/h) y de atropina pediátrica (3 mg por dosis): una sola fuente; Tiempo de observación del paciente expuesto asintomático antes del egreso; Letalidad de la intoxicación (más del 15 a 20 %; 2 a 40 %): cifras discordantes; Carbón activado 1 g/kg en la primera hora; Esquema de atropina de la guía colombiana de 2008 (2 a 5 mg y luego 1 mg cada 5 minutos): no se pudo confirmar en el PDF oficial; Periodicidad semanal y definición de caso (inicio dentro de 14 días) del evento 365 en el protocolo vigente del INS.
- **Pendiente:** Contrastar con el capítulo de inhibidores de colinesterasa de la guía MinSalud-OPS 2017 (dosis de atropina, indicación y dosis de pralidoxima, lavado gástrico y carbón activado): no se pudo leer el texto de ese capítulo
- **Pendiente:** Confirmar en el texto completo de la revisión Lancet 2008 el bolo de 1,8 a 3 mg con duplicación cada 5 minutos (verificado solo en protocolos que lo citan)
- **Pendiente:** La guía del Ministerio de Salud de El Salvador (Acuerdo 2968) apareció en una búsqueda atribuida por error a Chile; confirmar el país y el año
- **Pendiente:** Confirmar en el protocolo vigente del INS las reglas de notificación 365 frente a 356 y la periodicidad
- **Pendiente:** Dosis de benzodiacepinas y dosis pediátrica de pralidoxima según la fuente primaria
- **Pendiente:** Disponibilidad de pralidoxima y obidoxima en Colombia (INVIMA, nivel de atención) y si la guía colombiana mantiene la recomendación de oximas pese a la conclusión de Cochrane
- **Pendiente:** Uso de oximas en intoxicación por carbamatos o por un agente desconocido

## leishmaniasis
- **Nueva (2026-10-09):** redactada con búsqueda web; 16 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Intralesional según OPS 2022 para 1 a 3 lesiones de 3 cm o menos: solo una fuente secundaria; un esquema anterior hablaba de 4 lesiones de hasta 4 cm; Anfotericina B liposomal en la forma visceral: 3 mg/kg/día por 7 días o 4 mg/kg/día por 5 días (solo una fuente brasileña); dosis total de 15 a 30 mg/kg (MSF); Anfotericina B deoxicolato de 0,5 a 1 mg/kg/día y su dosis total; Pentoxifilina 400 mg cada 8 horas en la forma mucosa; Miltefosina de 1,5 a 2,5 mg/kg/día con máximo de 150 mg/día y dosis pediátricas para menos de 30 kg; Umbral de QTc de 500 ms para suspender el antimonial; Número de sesiones de termoterapia (una sola según la OPS frente a tres por semana en otra fuente); Porcentaje de sensibilidad del frotis directo; Calendario oficial de seguimiento de MinSalud (45 días, 3, 6 y 12 meses); Definición de caso del INS con más de 2 semanas de evolución de la lesión; Duración de 30 días en la forma mucosa (Brasil), distinta de los 28 días de Colombia.
- **Pendiente:** Versión vigente de la guía de MinSalud: solo se encontró la de 2010; confirmar si hay actualización de 2018 o posterior y si mantiene 'sin límite de dosis'
- **Pendiente:** Criterios de selección (número y tamaño de lesiones, localización), técnica y número de infiltraciones del lineamiento intralesional de MinSalud 2024
- **Pendiente:** Pentamidina en Colombia: número de dosis y si los 4 mg/kg son de sal o de base
- **Pendiente:** Dosis y esquema de anfotericina B liposomal y deoxicolato en las formas visceral y mucosa, en adultos y niños
- **Pendiente:** Termoterapia: número de sesiones y criterios de lesión elegibles
- **Pendiente:** Disponibilidad actual de la prueba de Montenegro en Colombia
- **Pendiente:** Criterios y plazos oficiales de curación y seguimiento para las formas cutánea, mucosa y visceral
- **Pendiente:** Miltefosina en niños de menos de 30 kg y su lugar en la guía colombiana
- **Pendiente:** Frecuencia del electrocardiograma durante el tratamiento y criterio de suspensión por QTc
- **Pendiente:** Manejo de gestantes con forma mucosa o visceral

## leptospirosis
- **Nueva (2026-10-09):** redactada con búsqueda web; 21 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Incubación habitual de 5 a 14 días (OMS 2003): no se encontró el texto; el Manual MSD da de 2 a 20 días; Proporción de formas graves o síndrome de Weil del 5 al 10 %: solo la dan fuentes secundarias; Letalidad del síndrome de Weil del 5 al 15 %; Título MAT único igual o mayor de 1:800 (criterio peruano) y de 1:400 para muerte probable (fragmento ambiguo del INS 2024); Umbral numérico de seroconversión MAT del INS: las fuentes dicen tanto 'cuatro diluciones' como 'cuatro veces'; Ceftriaxona 2 g IV durante 72 h y luego 1 g IM al día (fuente no identificada); Ceftriaxona pediátrica 80 a 100 mg/kg/día (solo la da MSF); Doxiciclina pediátrica 2 a 4 mg/kg/día (solo la da BMJ); Duración de la azitromicina (3 días en adultos; no establecida en niños); Dosis máxima de penicilina de 24 millones de U/día (solo en los lineamientos de El Salvador); Doxiciclina profiláctica 100 mg semanal entre 8 y 12 años (solo Argentina); Iniciar la profilaxis 1 a 2 días antes de la exposición; Amoxicilina 2 g/día (OMS 2003); Periodicidad de notificación (semanal o inmediata) y unidad de análisis de las muertes.
- **Pendiente:** Verificar en el PDF del protocolo INS 2024 si la ELISA IgM positiva forma parte de la definición de caso probable o es un criterio de clasificación posterior, dado que se notifica antes de tener el resultado
- **Pendiente:** Confirmar el criterio de seroconversión MAT del INS: incremento de cuatro diluciones frente a cuatro veces el título
- **Pendiente:** Confirmar la periodicidad de notificación y el manejo de las muertes (unidad de análisis) en el protocolo 2024
- **Pendiente:** Discrepancias de dosis en adultos: amoxicilina cada 6 h (CDC) frente a cada 8 h (MinSalud 2009); penicilina 1,5 millones de U (CDC) frente a 2 a 4 millones de U cada 6 h (MinSalud 2009). Verificar también si hay una guía clínica MinSalud/INS vigente posterior al protocolo de 2009
- **Pendiente:** Amoxicilina pediátrica: la herramienta MinSalud da 25 a 50 mg/kg/día y el protocolo de 2009 '40-50 mg/kg cada 8 horas', con una transcripción ambigua
- **Pendiente:** Quimioprofilaxis: no se encontró una recomendación colombiana vigente; el esquema se tomó de la nota técnica brasileña de 2024
- **Pendiente:** Los criterios de hospitalización se redactaron a partir de las manifestaciones de gravedad del INS 2024 y de los CDC, no de una lista oficial
- **Pendiente:** Incubación: ECDC da de 2 a 30 días y el Manual MSD de 2 a 20 días

## mordeduras-y-profilaxis-de-rabia
- **Nueva (2026-10-09):** redactada con búsqueda web; 20 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Periodicidad formal del evento 300 (inmediata o semanal) y del evento 670 de rabia humana: las fuentes se contradicen. Solo quedó 'diligenciar de inmediato', como dice MinSalud; Suspender la vacuna si el animal sigue sano al quinto día de observación (boletín MinSalud 2015): no se encontró en los lineamientos vigentes; Quinta dosis el día 28 en inmunosuprimidos y suero también en exposición leve (categoría II) en inmunosuprimidos: las fuentes se contradicen; Número de dosis previas que define a alguien como 'previamente vacunado' (al menos 2 dosis) y esquema colombiano específico de reexposición; Dosis pediátricas de metronidazol, clindamicina y doxiciclina para alérgicos a la penicilina; Duración exacta del tratamiento de una herida ya infectada (de 7 a 10 días), que solo aparece en una fuente secundaria; Período de observación de 14 días (fuente antigua y no confiable); Que la vacuna y el suero no requieran ajuste en la insuficiencia renal: no se buscó ni se verificó, así que no se escribió; Cifras de agresiones notificadas en 2024 (unas 180 000): no hacían falta en la guía.
- **Pendiente:** Confirmar en el lineamiento vigente de MinSalud e INS que el esquema de 4 dosis (0, 3, 7 y 14) reemplazó al de 5 dosis de la guía de 2009, y que aplica tanto a la exposición leve como a la grave. El documento de escenarios del PAI no tiene fecha visible
- **Pendiente:** Contrastar con el algoritmo actual del INS la definición de 'no exposición': si un perro o gato observable y sano que muerde en la cara o la mano queda en 'no exposición' con observación, frente a los criterios por localización de la guía de 2009
- **Pendiente:** Verificar si Colombia adoptó la regla de la OMS 2018 de no aplicar el sobrante del suero por vía intramuscular, o si sigue la de 2009 (resto en el glúteo). Verificar también si el inserto del suero disponible en Colombia aún exige prueba cutánea
- **Pendiente:** El límite de 7 días para la inmunoglobulina proviene de la ficha técnica de HyperRAB y de guías de Estados Unidos, no de la guía colombiana
- **Pendiente:** El umbral de 3 meses para la reexposición sin vacuna proviene de diapositivas que resumen a la OMS 2018: confirmarlo en el documento WER 2018
- **Pendiente:** Dosis pediátrica de amoxicilina-clavulanato: verificar la tabla original de IDSA 2014; la cifra proviene de protocolos pediátricos (UCSF, Children's Mercy)
- **Pendiente:** Tétanos: IDSA da 10 años y CDC da 5 años para heridas contaminadas. Definir cuál adoptar y si en Colombia se usa Td o Tdap
- **Pendiente:** La regla de no reiniciar el esquema si se retrasa una dosis proviene de un acta distrital de Bogotá (2023): confirmarla en el lineamiento nacional
- **Pendiente:** Disponibilidad real en Colombia de la inmunoglobulina antirrábica humana frente al suero equino

## crecimiento-y-desarrollo-infantil
- **Nueva (2026-10-09):** redactada con búsqueda web; 19 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Puntos de corte en DE del IMC para la edad en menores de 5 años y en 5 a 17 años (delgadez, riesgo de delgadez, sobrepeso, obesidad); Puntos de corte del peso para la edad (riesgo de desnutrición global de −2 a <−1 DE); Rango de edad exacto de la EAD-3 (0 a 6 años según MinSalud en prensa frente a 0 a 7 años en los estudios de validación) y puntajes típicos por edad; Sensibilidad del 100 % y especificidad del 40 % de la EAD-3 (un solo estudio, 24 niños); Dosis de hierro de 24 a 59 meses en la ruta (los resúmenes discrepan: 3 mg/kg/día frente a 2 mg/kg/día por 30 días cada 6 meses); Esquema de los micronutrientes en polvo (ciclo cada 6 meses, número de sobres); Vitamina A en la ruta colombiana para 6 a 11 y 12 a 23 meses (resúmenes contradictorios); Umbral de anemia del 20 % para los micronutrientes en polvo (OMS); Definición de primera infancia en la Res. 3280 (8 días a 5 años, 11 meses y 29 días); Periodicidad de la consulta de salud bucal desde los 6 meses; Medición rutinaria del perímetro cefálico hasta los 3 años; Longitud en decúbito hasta los 2 años y talla de pie después; Ausencia de palabras sueltas a los 16 meses como signo de alarma.
- **Pendiente:** Contrastar el cronograma de consultas de primera infancia con el cuadro modificado por la Res. 276 de 2019
- **Pendiente:** Verificar en el texto oficial de la Res. 3280 la dosis y la edad de inicio de vitamina A, hierro en preescolares, micronutrientes en polvo y albendazol 400 mg (esta dosis sale de un protocolo derivado y de la OMS, no del texto oficial)
- **Pendiente:** Completar desde el anexo técnico de la Res. 2465 los puntos de corte del IMC para la edad (0-5 y 5-17 años) y del peso para la edad
- **Pendiente:** Confirmar el rango de edad de la EAD-3 y en qué consultas es obligatoria
- **Pendiente:** Confirmar los criterios AIEPI de cada clasificación del desarrollo
- **Pendiente:** Los signos de alarma por edad (balbuceo, frases de dos palabras) vienen de fuentes no colombianas: contrastar con AIEPI y el manual de la EAD-3
- **Pendiente:** Revisar que los códigos CIE-10 elegidos sean adecuados (R62.0, R62.8, E34.3, Q02, F80.9, F82, F88, F89, E44.1)

## diabetes-gestacional
- **Nueva (2026-10-09):** redactada con búsqueda web; 24 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Criterios NDDG de la PTOG de 100 g (105/190/165/145 mg/dL): ningún resultado los confirmó; Riesgo de diabetes tipo 2 tras DMG de 50–70 % en 15–25 años: las fuentes no coinciden (cerca de 50 %, más de la mitad en 10 años, 70 % de por vida); Parto en DMG mal controlada a las 37 0/7–38 6/7 semanas: otra adaptación dice 36 0/7–38 6/7 y el CO 831 dice individualizar; Ofrecer cesárea programada en diabéticas con peso fetal estimado ≥4 500 g (ACOG 190): no verificado; Dosis de ejercicio para DMG (150 min/semana, 30 min 5 días/semana): fuentes contradictorias; Dosis inicial de NPH nocturna de 0,2 U/kg: una sola fuente; Requerimientos de insulina por trimestre (0,8/1,0/1,2 U/kg/día): una sola fuente; NICE: considerar insulina con ayunas de 6,0–6,9 mmol/L si hay macrosomía o polihidramnios: no verificado; Puntos de corte de la PTOG atribuidos textualmente a la Resolución 3280: no se encontró el texto; Meta alternativa de HbA1c <7 % (ADA): no verificada; Porcentaje de DMG controlada solo con dieta (70–85 %): no buscado ni verificado; Proporción de 26–46 % que necesita insulina con metformina: se dejó solo 'cerca de la mitad' (SMFM); Umbrales de diabetes manifiesta en el primer control (≥126 mg/dL, HbA1c ≥6,5 %): no se reverificaron; el texto remite a los criterios estándar sin cifras; Conversión a mg/dL de los umbrales de NICE: se dejaron solo en mmol/L.
- **Pendiente:** Confirmar en el anexo técnico de la Resolución 3280 de 2018 los puntos de corte de la PTOG y qué hacer ante una glicemia de ingreso alterada
- **Pendiente:** La dosis inicial de insulina de 0,7–1,0 U/kg/día no se verificó en el texto primario de ACOG ni de ADA; contrastar o atribuir bien
- **Pendiente:** La meta de NICE a las 2 h (6,4 mmol/L) y los umbrales de 100 g de dos pasos solo se verificaron en resúmenes secundarios
- **Pendiente:** Momento del parto en DMG mal controlada o con complicaciones: contrastar con ACOG CO 831
- **Pendiente:** Ya existe la edición 2026 de los Standards de ADA (Diabetes Care 49 Suppl 1, sección 15): revisar cambios frente a 2025
- **Pendiente:** Tabla 1 de factores de riesgo de la actualización ACOG 2024 y prueba preferida para el tamizaje temprano
- **Pendiente:** No se pudo abrir el texto primario de ninguna guía (WebFetch no funciona); casi todas las cifras se verificaron en resúmenes y revisiones
- **Pendiente:** Manejo neonatal (umbrales y horario de glucometrías del recién nacido) no incluido; remitir a la guía neonatal correspondiente

## escabiosis-y-pediculosis
- **Nueva (2026-10-09):** redactada con búsqueda web; 23 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Más de 200 millones de personas con escabiosis (OMS): no apareció en el texto de la nota descriptiva, solo en revisiones; Prevalencia acumulada en Colombia 2009–2019 de 5,3 por 100 000: verificada, pero viene de un informe no publicado; se omitió; Concentración del azufre precipitado (5–10 % frente a 6 %): no se verificó en la guía vigente de los CDC; Benzoato de bencilo al 25 % en sarna costrosa (CDC): no se verificó la concentración; Duración de la bolsa plástica para escabiosis (72 horas frente a 7 días): las fuentes difieren, así que se usó la frase de los CDC 'varios días a una semana'; Edad mínima del spinosad (4 años frente a 6 meses): fuentes contradictorias; se omitió el producto; Regreso al colegio o al trabajo el día siguiente al tratamiento de escabiosis: no se verificó; Definición de brote institucional de escabiosis (2 o más casos) y código o evento específico en el Sivigila: no se encontraron; Año del lineamiento de escabiosis de MinSalud: no se pudo confirmar; Liendres a más de 1/4 de pulgada del cuero cabelludo, no viables: no se buscó; Dosis de ivermectina oral para la pediculosis: no se buscó.
- **Pendiente:** Contrastar con el texto completo de AAP 2022 (Pediatrics) el intervalo de repetición de la permetrina al 1 % (7 a 10 días o día 9), el algoritmo para la resistencia y las edades de cada alternativa; lo verificado proviene de informes AAP anteriores y de los CDC
- **Pendiente:** Verificar en el PDF de IUSTI 2017 los intervalos de permetrina (7 a 14 días) e ivermectina (7 días) y el esquema de benzoato de bencilo; se verificaron por un resumen secundario
- **Pendiente:** Lineamiento de escabiosis de MinSalud: año, conducta ante brotes, definición de brote y mecanismo de notificación al INS y al Sivigila (el texto solo dice 'informar a la secretaría de salud territorial')
- **Pendiente:** Registro Invima en Colombia de ivermectina tópica al 0,5 %, malatión, alcohol bencílico, dimeticona al 4 % y azufre magistral
- **Pendiente:** Aplicación de permetrina en cuero cabelludo y cara en lactantes y adultos mayores: las guías difieren
- **Pendiente:** Tratamiento en menores de 2 meses (permetrina fuera de indicación frente a azufre) y evidencia emergente de ivermectina en niños de menos de 15 kg
- **Pendiente:** Tratamiento simultáneo de residentes, personal y visitantes en brotes institucionales: no se verificó textualmente en la página de los CDC
- **Pendiente:** Los criterios de remisión u hospitalización se redactaron por criterio clínico; ninguna guía los fija explícitamente
- **Pendiente:** Inflamabilidad del malatión: no se verificó con búsqueda

## lactancia-materna
- **Nueva (2026-10-09):** redactada con búsqueda web; 17 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Lactancia exclusiva en Colombia del 36,1 % según ENSIN 2015 (solo hallada en fuente secundaria del Concejo de Bogotá); Umbral de 12 a 24 h (o 24 h) sin mejoría para iniciar antibiótico en mastitis: hay discrepancia entre resúmenes y no hallé el texto de ABM 2022; Dosis de clindamicina en mastitis (las fuentes dan 300 mg cada 6 h, 300 mg cada 8 h y 300-450 mg cada 8 h); Absceso en el 3 a 11 % de las mastitis (fuente única no autoritativa); Ibuprofeno 800 mg en mastitis según ABM 2022 (no verificado); 6 o más pañales mojados al día desde el día 5 (las fuentes no coinciden); Varicela materna entre 5 días antes y 2 días después del parto como contraindicación temporal (solo en tabla secundaria, no en CDC); Ley 1823 de 2017: umbral de capital de 1 500 SMLMV o más de 50 trabajadores para salas de lactancia (fuente secundaria única); ABM 2010/2017: 6 a 8 h a temperatura ambiente en condiciones muy limpias (parece corresponder a la versión de 2010); Número de sesiones de apoyo a la lactancia en la Res. 3280 de 2018 (no encontrado).
- **Pendiente:** Confirmar en el texto de ABM 2022 (protocolo 36) el criterio de tiempo para iniciar antibiótico, la recomendación sobre masaje profundo y drenaje linfático, y la duración del antibiótico
- **Pendiente:** Confirmar que la GPC colombiana de VIH en menores de 13 años (fórmula hasta los 12 meses) sigue vigente y si la GPC VIH 2021 o la ruta materno perinatal la modificaron
- **Pendiente:** Verificar en la página de CDC la frase 'contadas desde que quedó completamente descongelada' para las 24 h en nevera
- **Pendiente:** Contrastar con la fuente primaria los criterios de 8 a 12 tomas, pérdida de hasta el 10 % y recuperación del peso a las 2 semanas (atribuidos a protocolos hospitalarios del NHS y de Australia, no a la OMS ni a la AAP)
- **Pendiente:** Verificar en la Res. 3280 de 2018 qué atenciones de promoción y apoyo de la lactancia incluye la ruta materno perinatal
- **Pendiente:** Revisar si la AAP actualizó la recomendación de vitamina D de 2008 y si MinSalud la adopta
- **Pendiente:** Revisar el lineamiento vigente del PAI sobre la vacuna de fiebre amarilla en la mujer lactante (la Circular 014 de 2017 habla de precaución; puede haber una circular posterior, de 2024)
- **Pendiente:** Revisar el criterio actual de CDC/AAP 2024 sobre VIH con supresión viral sostenida y lactancia (decisión compartida en EE. UU.) frente a la norma colombiana
- **Pendiente:** Confirmar la referencia completa del policy statement de la AAP 2022 (Pediatrics 2022;150:e2022057988)

## parasitosis-intestinal
- **Nueva (2026-10-09):** redactada con búsqueda web; 22 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Edades y periodicidad de la desparasitación en el anexo técnico de la Resolución 3280 de 2018 (no se encontró el texto); Dosis pediátrica de metronidazol en giardiasis (15 mg/kg/día en 3 dosis): no verificada; las fuentes usaron esquemas distintos; Metronidazol por 5 a 7 días en giardiasis (solo se verificaron 5 días y el rango Cochrane de 5 a 10 días); Paromomicina 25 a 35 mg/kg/día en 3 dosis: las fuentes difieren (otra da 10 mg/kg cada 8 h por 7 días); Pamoato de pirantel 11 mg/kg en dosis única para ascariasis (no verificado en ascariasis); Ivermectina 150 a 200 µg/kg en ascariasis: CDC la lista, pero una tabla de PMC la da como no recomendada; Prevalencia de geohelmintos por región en la ENPI (Amazonía 81,8 %, Sierra Nevada 74,0 %, cinturón árido pericaribeño 56,8 %): fuente única y posible confusión con la encuesta de 1980; Número de muestras analizadas en la ENPI (fuente única); Albendazol 200 mg para oxiuros en menores de 2 años (solo aparece en WikEM).
- **Pendiente:** Contrastar con el informe oficial de la ENPI 2012-2014 las cifras tomadas de fuentes secundarias: 81 % general, Blastocystis 60 % y prevalencias por especie
- **Pendiente:** Confirmar en el anexo técnico vigente de la Resolución 3280 de 2018 (y en la Resolución 276 de 2019) las edades y la periodicidad de la desparasitación, y si el lineamiento de 2013 sigue vigente
- **Pendiente:** Revisar la disponibilidad en Colombia (registro INVIMA) de tinidazol, nitazoxanida, paromomicina, yodoquinol y pamoato de pirantel, y si conviene mencionar alternativas locales como el secnidazol
- **Pendiente:** Dosis pediátricas de metronidazol en giardiasis y amebiasis, y dosis del agente luminal
- **Pendiente:** Paromomicina en la gestante con giardiasis: la fuente es un departamento de salud estatal de EE. UU.; contrastar con una guía obstétrica
- **Pendiente:** Ivermectina en menores de 15 kg: la ficha técnica no establece su seguridad, pero un metaanálisis sugiere que es segura; decidir la redacción
- **Pendiente:** Si alguna parasitosis intestinal o brote es evento de notificación al Sivigila (no se incluyó por no estar verificado)

## sangrado-primer-trimestre
- **Nueva (2026-10-09):** redactada con búsqueda web; 23 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Manejo expectante: expulsión completa en cerca del 80 % en 8 semanas (ACOG). Las fuentes secundarias no coinciden en si las 8 semanas son de gestación o de espera; Intervalo de la dosis repetida de misoprostol según ACOG (no antes de 3 h, dentro de 7 días): no se encontró el texto; Tasas de expulsión con mifepristona más misoprostol frente a misoprostol solo (83,8 % frente a 67,1 %; 83 % frente a 76 %): verificadas pero no incluidas, por espacio; Evitar el embarazo durante 3 meses después del metotrexato: no verificado; Beta-hCG 7 días después de la salpingostomía (NICE): no verificado; Manejo expectante del ectópico con beta-hCG menor de 200 mUI/mL (ACOG): no buscado ni verificado; Aumento mínimo de la beta-hCG en 48 h según ACOG (35 % o 49 %): no verificado; Dosis de anti-D según ACOG (50 µg frente a 300 µg) y recomendación de la OMS sobre anti-D antes de las 12 semanas: no verificadas; Masa ectópica de 3,5 cm como contraindicación relativa en ACOG: contradicho (ACOG 193 dice 4 cm); Consultar de nuevo si el sangrado persiste después de las 14 semanas (NICE): no verificado; Plazo máximo para la respuesta a la solicitud de IVE en Colombia: no verificado.
- **Pendiente:** Restricción anti-D de NICE (no hasta 11+6 semanas; al menos 250 UI desde las 12+0): año exacto y redacción de la actualización de NG126, tomados de un resumen de búsqueda
- **Pendiente:** Si la actualización de ACOG 2024 sobre Rh también cubre el embarazo ectópico (la guía la limita al aborto espontáneo o inducido)
- **Pendiente:** Regla de NICE para menos de 6 semanas con prueba en orina a los 7 a 10 días: solo la respalda una fuente secundaria
- **Pendiente:** Lista de contraindicaciones absolutas del metotrexato en el Box 1 de ACOG 193, y si la imposibilidad de seguimiento es absoluta o relativa (sin cifras, redactada de memoria)
- **Pendiente:** Hora de la doxiciclina preoperatoria (1 h frente a 30–60 min) y si ACOG 200 la recomienda textualmente
- **Pendiente:** Seguimiento de la mola (56 días, 6 meses, dos resultados normales con 4 semanas de diferencia): tomado del resumen de BMJ Best Practice, no del texto primario de RCOG GTG 38
- **Pendiente:** Atribución a ACOG 200 de los criterios de la SRU: confirmada con ASA, Radiopaedia y HSE, no con la tabla de ACOG
- **Pendiente:** NICE: salpingectomía frente a salpingostomía y criterios para preferir manejo médico o quirúrgico sobre el expectante (sin cifras, de memoria)
- **Pendiente:** Resolución 051 de 2023: vigencia actual, alcance de la objeción de conciencia y autonomía de las menores de 14 años (fuente: ACI Prensa)
- **Pendiente:** Signos clínicos de la mola descritos sin fuente buscada (útero grande, hiperémesis, hipertiroidismo, preeclampsia temprana)

## vacunacion-pai-y-adulto
- **Nueva (2026-10-09):** redactada con búsqueda web; 17 cifras verificadas con al menos una fuente secundaria que las dice textualmente.
- **Retirado antes de entrar:** Intervalo de 4 semanas entre las dos dosis de influenza en la primera vacunación infantil (no se verificó en el lineamiento colombiano); Ventana CDC de Tdap entre las semanas 27 y 36; Edad máxima de pentavalente, DPT, polio y neumococo en esquemas de recuperación; Edad mínima de contraindicación absoluta de fiebre amarilla (6 meses) y límite de 60 años como contraindicación; Esquema de neumococo para adultos dentro del PAI colombiano (edad y vacuna); Valencia de la vacuna neumocócica del PAI (la infografía 2025 dice trecevalente; no se confirmó); Edad de 19 a 49 años con riesgo para neumococo (CDC); Influenza universal desde los 6 meses (CDC) y dosis alta en mayores de 65 años; Esquema primario de Td en adulto no vacunado según CDC (0, 4 semanas, 6–12 meses); Fecha exacta del cambio del refuerzo de triple viral a 18 meses (una fuente dice enero de 2023).
- **Pendiente:** Confirmar en el afiche o lineamiento PAI 2026 si el ajuste por tosferina (6 semanas, 3 y 4,5 meses) sigue vigente o si se volvió al calendario de 2, 4 y 6 meses, y qué vacunas incluye (rotavirus y neumococo tienen 2 dosis primarias)
- **Pendiente:** Refuerzo de triple viral: MinSalud y Bogotá lo ponen a los 18 meses, pero una web secundaria de 2026 aún lo pone a los 5 años; verificar en el afiche 2026
- **Pendiente:** Edad de fiebre amarilla en el esquema regular (18 meses según la Circular 027 de 2015; un esquema distrital de 2025 parecería ubicarla a los 12 meses) y el alcance vigente de la Resolución 691 de 2025 y de la Circular 001 de 2026
- **Pendiente:** Semana de Tdap en gestantes: la Circular 011 de 2025 dice semana 26 (20 en rural disperso) y el ajuste de noviembre de 2025 dice semana 20 para todas; confirmar cuál rige
- **Pendiente:** Límite de la segunda dosis de rotavirus (11 meses y 29 días según el afiche 2026); esquemas antiguos usaban límites menores
- **Pendiente:** Si los refuerzos de 18 meses y 5 años son con DPT, pentavalente o polio inactivada u oral en el esquema vigente
- **Pendiente:** Oferta de neumococo y VSR para adultos y gestantes dentro del PAI colombiano
- **Pendiente:** Vigencia de las recomendaciones CDC/ACIP, dados los cambios de política en EE. UU. desde 2025
- **Pendiente:** Esquema de Td de 5 dosis: solo una fuente (anexo distrital del PAI) da los intervalos

## Guías de la primera tanda (33)
Redactadas sin acceso a las fuentes primarias. Todas requieren revisión médica completa antes de llenar
`revisado_por`; prioridad: dosis pediátricas (antibióticos, IRA, EDA, fiebre sin foco), embarazo (control
prenatal, preeclampsia) y urgencias (sepsis, ACV, TEP).
