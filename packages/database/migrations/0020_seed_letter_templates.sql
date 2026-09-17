-- The three letters a UAE tax agent sends most (FR-15).
--
-- Seeded as data rather than shipped in code, so the firm can change its own
-- wording without a deployment. These are a starting point and are expected to
-- be edited; what matters is that the client's name, licence number and tax
-- number come from the record instead of from somebody's memory of the last
-- letter they copied.

INSERT INTO document_templates (id, code, name_en, name_ar, body_en, body_ar) VALUES
(
  'tpl-engagement',
  'engagement_letter',
  'Engagement letter',
  'خطاب التكليف',
  E'{{today}}\n\nTo: {{client_name}}\nTrade licence: {{trade_licence}}\n\nDear Sirs,\n\nWe are pleased to confirm that {{firm_name}} has been engaged to act as your tax agent in the United Arab Emirates. Our engagement covers registration, the preparation and filing of returns, and correspondence with the Federal Tax Authority on your behalf.\n\nThis engagement begins on {{today}} and continues until either party ends it in writing.\n\nYours faithfully,\n\n\n{{signatory}}\n{{firm_name}}',
  E'{{today}}\n\nإلى: {{client_name}}\nالرخصة التجارية: {{trade_licence}}\n\nتحية طيبة وبعد،\n\nيسرّنا أن نؤكّد تكليف {{firm_name}} بالعمل وكيلًا ضريبيًا لكم في دولة الإمارات العربية المتحدة. يشمل التكليف التسجيل وإعداد الإقرارات وتقديمها ومراسلة الهيئة الاتحادية للضرائب نيابةً عنكم.\n\nيبدأ هذا التكليف بتاريخ {{today}} ويستمر حتى ينهيه أحد الطرفين كتابةً.\n\nوتفضّلوا بقبول فائق الاحترام،\n\n\n{{signatory}}\n{{firm_name}}'
),
(
  'tpl-authorisation',
  'emaratax_authorisation',
  'Authorisation to act on EmaraTax',
  'تفويض بالتعامل عبر إماراتاكس',
  E'{{today}}\n\nTo: The Federal Tax Authority\n\nAuthorisation to act\n\nWe, {{client_name}}, holding trade licence {{trade_licence}} and tax registration number {{vat_trn}}, authorise {{firm_name}} to act on our behalf on the EmaraTax portal.\n\nThis authorisation covers submitting returns, responding to enquiries and requesting amendments. It remains in force until withdrawn in writing.\n\nFor and on behalf of {{client_name}}\n\n\nName: __________________________\nSignature: __________________________\nDate: {{today}}',
  E'{{today}}\n\nإلى: الهيئة الاتحادية للضرائب\n\nالموضوع: تفويض بالتعامل\n\nنحن، {{client_name}}، حاملو الرخصة التجارية {{trade_licence}} ورقم التسجيل الضريبي {{vat_trn}}، نفوّض {{firm_name}} بالتعامل نيابةً عنّا عبر منصّة إماراتاكس.\n\nيشمل هذا التفويض تقديم الإقرارات والرد على الاستفسارات وطلب التعديلات، ويظلّ ساريًا حتى سحبه كتابةً.\n\nعن {{client_name}}\n\n\nالاسم: __________________________\nالتوقيع: __________________________\nالتاريخ: {{today}}'
),
(
  'tpl-deregistration',
  'vat_deregistration_request',
  'VAT deregistration request',
  'طلب إلغاء التسجيل الضريبي',
  E'{{today}}\n\nTo: The Federal Tax Authority\n\nApplication for VAT deregistration\n\nOn behalf of {{client_name}}, tax registration number {{vat_trn}}, trade licence {{trade_licence}}, we apply for deregistration from value added tax.\n\nThe grounds for this application, together with the supporting documents, are attached.\n\nFor and on behalf of {{client_name}}\n\n\n{{signatory}}\n{{firm_name}}\nTax agent',
  E'{{today}}\n\nإلى: الهيئة الاتحادية للضرائب\n\nالموضوع: طلب إلغاء التسجيل في ضريبة القيمة المضافة\n\nنيابةً عن {{client_name}}، رقم التسجيل الضريبي {{vat_trn}}، الرخصة التجارية {{trade_licence}}، نتقدّم بطلب إلغاء التسجيل في ضريبة القيمة المضافة.\n\nمرفق طيّه أسباب الطلب والمستندات المؤيّدة له.\n\nعن {{client_name}}\n\n\n{{signatory}}\n{{firm_name}}\nوكيل ضريبي'
)
ON CONFLICT (code) DO NOTHING;
