import {
  Body,
  Button,
  Container,
  Head,
  Html,
  pixelBasedPreset,
  Preview,
  Section,
  Tailwind,
  Text,
} from '@react-email/components';

interface AuthEmailProps {
  userName?: string;
  actionUrl?: string;
  previewText?: string;
  heading?: string;
  body?: string;
  buttonText?: string;
}

const AuthEmail = ({
  userName = 'there',
  actionUrl = '',
  previewText = 'Helix',
  heading = 'Action required',
  body = '',
  buttonText = 'Click here',
}: AuthEmailProps) => (
  <Html>
    <Head />
    <Tailwind config={{ presets: [pixelBasedPreset] }}>
      <Body className="mx-auto my-auto bg-white px-2 font-sans">
        <Preview>{previewText}</Preview>
        <Container className="mx-auto my-[40px] max-w-[465px] rounded border border-solid border-[#eaeaea] p-[20px]">
          <Section>
            <Text className="text-[20px] font-semibold text-black">{heading}</Text>
            <Text className="text-[14px]">Hi {userName},</Text>
            <Text className="text-[14px]">{body}</Text>
            <Button
              className="rounded bg-[#000000] px-5 py-3 text-center text-[12px] font-semibold text-white no-underline"
              href={actionUrl}
            >
              {buttonText}
            </Button>
            <Text className="text-[12px] text-[#666666]">
              If you didn&apos;t request this, just ignore and delete this message.
            </Text>
          </Section>
        </Container>
      </Body>
    </Tailwind>
  </Html>
);

export default AuthEmail;
